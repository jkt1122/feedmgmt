# Design Brief: Feed Assistant — Agent Design & Rule Architecture

**Status:** Proposed
**Audience:** Engineering
**Author:** Product
**Last updated:** 2026-06-06

---

## 1. Why this brief exists

The Feed Assistant today is a one-shot auditor: it samples a feed, maps issues to a
fixed set of hardcoded rules, and lets the merchant accept (saved forever) or dismiss
(forgotten immediately). We want to evolve it into a system that **accumulates a
per-merchant agreement about how each feed should be handled** — one that learns from
both acceptances and rejections, can reason about issues no hardcoded rule anticipated,
and can turn a merchant's plain-language request into a durable rule.

This brief covers two things:

1. **A structural simplification** — move all transformation logic from the data-source
   level to the sync level. Data sources become raw, read-only uploads.
2. **The agent design** — a single proposal pipeline that handles four categories of
   rules with one consistent safety-and-memory model.

Out of scope: file-size / throughput / latency engineering (handled separately).

---

## 2. Structural change: raw sources, rules live at the sync

### Today
Rules exist at three tiers — default global rules, user global rules, and **per-data-source
rules**. A data source is both "the uploaded file" and "a transformed view of that file."
This couples ingestion with transformation and forces the merchant to reason about the same
fixes in two places (source and sync).

### Proposed
- **A data source is just the original uploaded file.** No transforms, no rules, no
  "transformed view." The sources list shows the raw file as uploaded. Nothing more.
- **All transformation moves to the sync.** A sync selects one or more raw sources, and
  *all* the cleaning, optimizing, and validating happens there.
- This means the merchant has exactly one place where rules live and one mental model:
  *"raw data goes in, the sync is where the assistant cleans it for a destination."*

### Why
- **Simpler merchant model.** Sources = "my data." Syncs = "my data, prepared for Google /
  Meta." No duplicate rule surfaces.
- **Rules are inherently destination-specific anyway.** A title-length fix for Google differs
  from Meta; forcing source-level rules to be destination-agnostic was always awkward.
- **One execution path.** Everything that transforms data now lives in the sync pipeline,
  which simplifies the engine, the memory model, and the agent.

### Migration note
Existing source-level rules need a path to sync-level (or a clean deprecation). Eng to
decide whether to migrate or reset; product preference is to migrate where a source maps
to exactly one sync, and otherwise prompt the merchant.

---

## 3. The four rule categories (all at the sync level)

When a sync runs, the assistant evaluates the feed and can propose rules in four categories.
**All four are the same kind of object (a rule) and flow through the same pipeline** — they
differ only in where the proposal *originates*.

| # | Category | Originates from | Example |
|---|----------|-----------------|---------|
| 1 | **Basic fixes** | The known catalog (formerly source-level defaults) | Trim whitespace, strip HTML, normalize price/availability/condition |
| 2 | **Platform optimization** | Destination spec for this sync's platform | Truncate titles to platform max, flag missing GTIN/brand/image |
| 3 | **Agent-reasoned recommendations** | The AI's free-form analysis of *this* feed | "4,000 titles start with the SKU — strip it to improve ad relevance" |
| 4 | **User requests** | A merchant's plain-language instruction | "Add 'Sale' to the title when category is Clearance" |

Categories 1 and 2 are deterministic (the assistant knows to look for them). Categories 3
and 4 are open-ended. **The key design insight is that they all become the same thing — a
saved, re-applied, remembered rule — and they all pass through the same safety gate.**

---

## 4. The core principle: open reasoning, closed execution

Categories 3 and 4 require the AI to be creative. That seems to conflict with safety. We
resolve it with one rule:

> **The AI is open-ended in *what it reasons about*. It is closed in *what it can execute*.**

- The AI may discover **any** pattern in a feed and may interpret **any** user sentence.
- But every proposal must be expressed as a **configuration of known building blocks** —
  the vetted set of fix primitives the engine knows how to run safely (a condition + an
  action over a field).
- If the AI cannot express a fix as a configuration of building blocks, it may still **flag
  the issue for a human** ("your descriptions read as spammy"), but it **cannot create an
  automated rule** for it.

Creativity lives in *detection and configuration*, never in *execution primitives*. This is
what lets us give the agent open-ended power without ever letting it run unvetted logic
against merchant data.

---

## 5. The unified proposal pipeline

Every proposal — regardless of category — flows through one pipeline:

```
        proposal originates from...
   ┌────────────┬───────────────┬───────────────┬─────────────┐
   │ basic      │ platform      │ agent          │ user        │
   │ fixes (1)  │ optimization  │ reasoning (3)  │ request (4) │
   │            │ (2)           │                │             │
   └─────┬──────┴───────┬───────┴───────┬────────┴──────┬──────┘
         │              │               │               │
         ▼              ▼               ▼               ▼
   ─────────────────────────────────────────────────────────
   │  express as a configuration of known building blocks    │  ← safety boundary
   ─────────────────────────────────────────────────────────
                          │
                          ▼
            validate against the building-block catalog
            (drop anything malformed or unknown)
                          │
                          ▼
            DRY-RUN against the merchant's real feed
            (before/after examples + affected count)
                          │
                          ▼
            present to merchant with examples + scope choice
                          │
                ┌─────────┴─────────┐
              accept              reject
                │                   │
           save as rule        reject-memory
           (with scope)        (with scope)
                │                   │
                └─────── consulted on every future sync ──────┘
```

Build this pipeline **once**; all four categories inherit safety, preview, and learning for
free. Adding a fifth way to originate a proposal later (e.g. a template library) just plugs
into the top.

---

## 6. The four systems eng needs to build

### 6.1 The building-block catalog (single source of truth)
**Problem today:** the knowledge of "what fixes exist" is scattered across four places that
must be hand-kept in agreement — the execution engine, the validator, the AI's instructions,
and logic embedded in the web/router layer. They drift apart silently: the AI suggests fixes
the engine can't run, or the engine has abilities the AI never offers.

**Build:** one registry that defines each fix primitive **once** — its name, what it does,
how it's validated, and how it's described to the AI. The engine, the validator, and the AI's
instructions all *read from* this registry. Add a new fix in one place and the whole system
updates together.

**Why it matters:** this is the answer to "updating rules/skills must not break the agent."
It also directly enables open-ended reasoning — the richer the catalog, the less often the AI
hits the "I can't express that as a rule" wall.

### 6.2 The validation gate
**Build:** nothing becomes an active or even *displayed* rule until it's validated against the
catalog. Anything malformed or outside the catalog is dropped before it reaches the merchant or
the data.

**Why it matters:** this is what makes the agent **safe to iterate on.** You can swap models,
rewrite prompts, or add fix types, and the worst case is "the assistant proposes nothing," never
"the assistant corrupted a feed."

### 6.3 The dry-run-with-examples engine (the linchpin)
**Build:** the ability to take any proposed rule, run it against the merchant's real feed
*without committing*, and return honest before/after samples plus an affected-row count.

**Why it matters:** this is the centerpiece. It serves three jobs at once:
- **Trust** — the merchant never accepts a change blind; the example *is* the proof.
- **Correctness check** — if the AI's rule doesn't do what it claimed (zero rows affected,
  garbled output), we catch it automatically, before the user sees it.
- **Disambiguation** — for user requests, showing a concrete interpretation with real
  examples *is* the clarifying question. The user corrects the example, not an abstract spec.

Both open-ended features (categories 3 and 4) are unsafe without this engine and delightful
with it. Treat it as the priority build.

### 6.4 Accept / reject memory (with scope and stable identity)
**Problem today:** acceptance works (saved as a rule), but rejection is amnesia — a single
"seen" flag. The next sync re-audits and re-proposes the exact thing the merchant just
rejected. To a user this reads as "the assistant doesn't listen."

**Build two equally first-class memories:**
- **Accepted** = "always do this, don't ask again." (works today)
- **Rejected** = "I considered this and said no — don't raise it again." (missing today)

Both are filters the assistant consults *before it speaks*. The audit produces candidates;
memory subtracts settled questions; only genuinely new issues reach the merchant. That
subtraction is what makes the assistant feel like it learns.

Two requirements on the memory:
- **Stable identity.** A memory is keyed by a **fingerprint of what the rule does** (field +
  condition + action), not by its English phrasing. Reword a prompt and the memory must still
  hold.
- **Scope.** Every accept and reject carries a scope: *this sync* / *this platform* / *all my
  feeds*. Product default for rejections is the **broadest sensible scope** (merchant-wide)
  with an easy "just this sync" override — re-asking the same question across feeds is more
  annoying than occasionally over-suppressing.

---

## 7. The two open-ended features in detail

### 7.1 Agent-reasoned recommendations (category 3)
1. The AI scans the feed and reasons freely about quality and ad-performance problems —
   unconstrained.
2. For each issue, it expresses the fix as a configuration of building blocks. If it can't,
   it may flag the issue for a human but not propose an automated rule.
3. The proposal is validated, then dry-run against the real feed for examples + count.
4. Presented to the merchant: *"I noticed X across N products — here's what I'd do: [before/
   after]. Save it?"*
5. Accept → saved rule, re-applied every sync. Reject → reject-memory.

**Product note:** "show me real examples from my data" is not a nice-to-have — it is the
safety mechanism that makes open-ended reasoning acceptable.

### 7.2 User-requested rules (category 4)
1. Merchant describes intent in plain language ("insert 'Sale' into title when category is
   Clearance").
2. The agent **translates** (it does not invent) — mapping the sentence to a condition +
   action over the building blocks.
3. Same dry-run-with-examples step: *"Here's what that does to 230 products — [before/after].
   Save it?"*
4. Confirm → saved rule with scope + memory, identical to every other rule.

**Two deliberate design points:**
- **Ambiguity is resolved by example, not interrogation.** "Insert" (start? end? replace?),
  "is Clearance" (exact? contains?) — the agent shows a concrete interpretation with examples
  and lets the merchant correct it.
- **The escape hatch.** Some requests map to no building block ("make my titles sound more
  premium"). The agent must not hallucinate a rule — it says "I can't make that a repeatable
  rule, but I can do it as a one-time pass," or offers the closest rule it *can* build. Knowing
  the boundary between a durable rule and a one-off is a real product decision.

---

## 8. What the merchant experiences

One consistent ritual, regardless of where a proposal came from:

> **The assistant proposes → shows me exactly what it would do to my data → I decide → it
> remembers my decision.**

- Sources are simple: upload, see your raw file.
- The sync is where the assistant works: it walks through basic fixes, platform optimizations,
  its own discoveries, and anything you ask for.
- Nothing changes your data without showing you a real example first.
- It never re-asks a settled question.
- Over time the assistant gets quieter and your feeds get cleaner with less input — the
  product goal.

---

## 9. Sequencing (product priority)

| Priority | Build | Merchant-visible value | Risk it removes |
|----------|-------|------------------------|-----------------|
| 1 | Building-block catalog (6.1) | (invisible) | Agent/engine drift |
| 2 | Validation gate (6.2) | (invisible) safe, consistent fixes | Feed corruption |
| 3 | Dry-run-with-examples engine (6.3) | "I can see what it'll do" | Blind acceptance |
| 4 | Accept/reject memory + scope (6.4) | "It listens and stops nagging" | Trust erosion |
| 5 | Category 3 + 4 surfaced in the assistant UI | "It's actually smart" | — |

Items 1–4 are infrastructure; they make 5 both safe and delightful. The structural
simplification (§2) should land first or alongside item 1, since it defines where rules live.

---

## 10. Open questions for eng + product

1. **Source-rule migration** — migrate existing source-level rules to sync level, or reset?
2. **Catalog expressiveness** — how rich must the building-block set be so categories 3 and 4
   rarely hit the "can't express that" wall? (Worth an explicit pass.)
3. **One-off passes** — do we support non-durable, one-time transformations (the category-4
   escape hatch), and how do they appear vs. saved rules?
4. **Reject-memory default scope** — confirm merchant-wide default with per-sync override.
5. **Rule ordering / conflicts** — when categories stack (a basic fix + a user rule touch the
   same field), what determines order, and does the dry-run show the *combined* effect?
