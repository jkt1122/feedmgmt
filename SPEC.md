# Product Feed Manager — Product Specification

**Version:** 3.0  
**Date:** 2026-06-03  
**Status:** In Review

---

## 1. Overview

A web tool for Shopify merchants to manage, clean, and export product catalog feeds to Google Merchant Center and Meta Catalog.

The core model is a **two-stage pipeline**:

```
[Data Sources] → [Source Pipeline] → [Platform Syncs] → [Export]
```

**Data Sources** are raw CSVs (or future: Shopify API, URL sync). The **Source Pipeline** cleans and standardizes them in a platform-agnostic way — this runs automatically on every sync. **Platform Syncs** are named, per-platform export configurations: each sync selects one or more sources, applies optional filters, runs platform-specific optimizations, and exports on a schedule. **Exports** are the final downloadable feeds.

The AI operates at both stages: generic data quality at the Source Pipeline, deep platform-spec knowledge at the Platform Sync layer.

---

## 2. Target User

Solo or small-team Shopify merchants running Google Shopping and Meta Advantage+ Catalog campaigns who want cleaner, better-performing feeds without the complexity or cost of Feedonomics / GoDataFeed / Marpipe.

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Full-stack, great DX, built-in API routes |
| UI | shadcn/ui + Tailwind | Fast, composable, looks professional |
| Backend | Next.js API routes + tRPC | Type-safe, no separate backend to maintain |
| Database | PostgreSQL via Supabase | Managed, has auth, storage, real-time built in |
| File storage | Supabase Storage | CSV uploads + generated feed files |
| AI | Claude API (claude-sonnet-4-6) | Pipeline recommendations, field optimization, agentic chat |
| Job queue | Inngest | Scheduled syncs, large batch processing |
| Auth | Supabase Auth | Email/password to start, OAuth later |
| Hosting | Vercel | Zero-config Next.js deployment |

---

## 4. Core Concepts

| Concept | Definition |
|---|---|
| **Data Source** | A raw CSV uploaded by the merchant, representing a product catalog or a related dataset (pricing, inventory) |
| **Source Pipeline** | Platform-agnostic transformation layer: field mapping, dedup, format standardization, quality fixes. Runs automatically on every sync. |
| **Pipeline Rule** | A persistent transformation step in the Source Pipeline (e.g. "standardize condition values", "remove duplicate IDs") |
| **Canonical Product** | A product record after Source Pipeline processing — clean, deduplicated, normalized. The input to all Platform Syncs. |
| **Platform Connection** | A merchant's linked account for a platform (Google Merchant Center, Meta Catalog). Configured once at the platform level; shared by all syncs on that platform. |
| **Platform Sync** | A named, configured export pipeline for a specific platform. A merchant can have multiple syncs per platform (e.g. "Summer Footwear" and "Winter Accessories" both under Google Shopping). |
| **Sync Rule** | A rule scoped to a Platform Sync: field optimization, a custom transformation, or a platform best-practice fix. Rules have an origin tag: AI-recommended, platform spec, filter, or manual. |
| **Recommendation** | An AI-generated suggestion for a Pipeline Rule or Sync Rule, surfaced on first upload/setup and when new issues are detected |
| **Export** | The final downloadable file (TSV/CSV) generated from a Platform Sync, ready for GMC or Meta upload |

---

## 5. Feature Scope — Phase 1

### 5.1 Authentication

- Email + password signup/login via Supabase Auth
- Single merchant workspace per account (multi-workspace is Phase 2)

---

### 5.2 Data Sources

**Upload flow:**
1. Merchant uploads one or more CSVs
2. System parses headers, shows field mapping UI
3. Merchant maps their columns to canonical fields
4. Mapping is saved — future uploads from the same source auto-apply it
5. Source enters the Source Pipeline immediately on upload

**Multiple sources:**
- A merchant can have multiple Data Sources (e.g. main catalog, clearance items)
- Each source maintains its own field mapping and upload history
- Sources are listed in the sidebar under "Data Sources"

**Data Source view — Transformed / Original tabs:**
- Default view is **Transformed** — the post-pipeline canonical data. This is what Platform Syncs consume.
- **Original** tab shows the raw uploaded CSV data for reference
- A **transformation strip** below the tab bar shows a summary of active rules ("8 transformations applied"). Clicking it expands a panel showing all Pipeline Rules with on/off toggles, row counts, and origin tags (AI / Manual).
- Issues in the data source (missing fields, inconsistent values, broken image URLs) are surfaced by the Feed Assistant, not as raw error counts in the header.

**Future (Phase 2):** Source-level column joining — combining columns from two different feeds into one canonical record (e.g. product data + inventory feed joined on product ID).

---

### 5.3 Source Pipeline

The Source Pipeline runs automatically on every sync. Its job is to produce a clean, normalized **canonical dataset** that all Platform Syncs consume.

**Pipeline stages (in order):**

| Stage | What it does |
|---|---|
| Field mapping | Maps source columns to canonical fields |
| Deduplication | Keeps first occurrence of duplicate product IDs; flags removed rows |
| Format standardization | Normalizes price formats, availability values, condition values, date formats |
| Quality fixes | Fixes obvious typos, strips invisible characters, trims whitespace, normalizes casing |
| Validation | Flags missing required fields, out-of-range values, broken image URLs |

**Recommendations on first upload:**
- AI scans the source and proposes a set of Pipeline Rules
- Each recommendation shows: what it fixes, how many rows it affects, a before/after preview
- Merchant approves or rejects each recommendation individually
- Approved recommendations become persistent Pipeline Rules that run on every future sync

**Repeat syncs:**
- Approved rules run silently in the background
- Pipeline status is always accessible (last run time, rules applied, rows affected, new issues found) but does not interrupt the merchant's workflow
- New data quality issues not covered by existing rules surface for review
- Merchant can toggle any rule on/off at any time

**Pipeline Rule management:**
- Rules are surfaced in the transformation strip panel on the Data Source view
- Each rule shows: label, origin (AI / Manual), rows affected on last run, on/off toggle
- Reordering is supported (rules execute top-to-bottom; order matters for chained transforms)
- New rules can be added by asking the Feed Assistant in plain English

---

### 5.4 Platform Connections

Platform connections are configured once per platform, at the platform level — not per sync.

- **Google Shopping:** link a Google Merchant Center account via OAuth
- **Meta Catalog:** link a Meta Business account via OAuth
- Connection status is shown in the sidebar next to the platform name (green dot = connected)
- All Platform Syncs under a platform share the same connection
- Connection settings live in Settings, not in the sync setup flow

---

### 5.5 Platform Syncs

A merchant can create **multiple named Platform Syncs** under each platform. For example, under Google Shopping: "Summer Footwear", "Winter Accessories", "Clearance Only". Each sync is an independent pipeline with its own sources, filters, rules, and schedule.

**Sidebar hierarchy:**
```
Platform Syncs
  Google Shopping  ● (connected)
    Summer Footwear
    Winter Accessories
    + New sync
  Meta Catalog  ● (connected)
    All Products
    + New sync
```

If a platform is not yet set up (no connection configured), its section in the sidebar shows a single "Setup →" link instead of sync items.

#### 5.5.1 Sync Setup

When creating a new sync, the merchant configures:

**Step 1 — Name and data sources:**
- Give the sync a name (e.g. "Summer Footwear", "Clearance Only")
- Select one or more Data Sources (transformed). Multiple sources are merged and deduplicated automatically.
- A live row count preview shows the combined total after dedup.

**Step 2 — Filter rules (optional):**
- Limit which canonical products are included in this sync
- Simple condition builder: field / operator / value (e.g. `availability is in_stock`, `price greater than 10`, `category contains "Footwear"`)
- Multiple conditions combined with AND
- A live preview shows the estimated row count after filtering
- Filters are stored as Sync Rules with origin tag "Filter" and appear first in the rules panel

**Step 3 — Sync schedule:**
- Automatic sync: runs on a recurring schedule — every 6h / 12h / 24h
- Schedule is per-sync, independent of the data source refresh schedule

**Note:** There is no "one-time export" schedule option. Manual export is always available via the "Export feed" button on the active sync view.

#### 5.5.2 Active Sync View

The active sync view shows the enhanced, platform-optimized product data for that sync.

**Manage sync panel (always accessible, collapsed by default):**
- A control bar below the topbar that expands to show the full sync configuration and rules
- Header shows: `{sync name} · {N} sources · ~{row count} rows · syncs every {interval}`
- Expanded view has two sections:
  1. **Configuration** — Sources, Filters, and Schedule displayed as a readable summary with an "Edit setup" button
  2. **Active rules** — all Sync Rules with on/off toggles, row counts, and origin tags (Filter / Google spec / Meta spec / AI / Manual)
- The manage panel is the entry point for both editing setup and managing rules

**Source issues notice:**
- If any data source feeding this sync has unresolved data quality issues, a contextual notice is shown below the topbar
- The notice names the specific data source (e.g. "Summer 2026 — Footwear has potential issues — 240 products missing brand field, 18 with inconsistent condition values, 5 with broken image URLs")
- The notice links directly to that data source for the merchant to fix
- The notice is dismissible

**Topbar actions:**
- **Sync now** — triggers an ad-hoc run of the sync pipeline
- **Export feed** — generates and downloads the export file on demand

#### 5.5.3 Platform-Specific Optimizations

AI-powered recommendations grounded in each platform's official specs and best practices. Applied as Sync Rules with origin tag "Google spec" or "Meta spec".

**Google Shopping:**
- Title rewrites: keyword-front loading, 70-char limit for Shopping ads, no promo text
- Description: relevant attributes, no URLs or promo language
- `google_product_category`: auto-suggest from Google's taxonomy; bulk-accept high-confidence or review individually
- GTIN: flag missing GTINs for branded products (required by Google)
- Custom labels 0–4: suggest values for price tiers, margin bands, or categories (useful for Smart Bidding)
- Image resolution: flag products below Google's 800×800px minimum

**Meta Catalog:**
- Title rewrites: 100-char limit, different keyword conventions than Google
- `fb_product_category`: suggest from Meta's taxonomy
- Additional images: flag products with only 1 image (Meta recommends 4–8)
- Availability: normalize to Meta's accepted values

**Recommendation flow:**
1. On first sync, the AI scans all products against platform spec
2. Groups issues by type with counts: "3 products missing GTIN", "8 below image resolution"
3. Each issue links to an inline action in the Feed Assistant ("Fix now →")
4. Accepted recommendations become persistent Sync Rules

#### 5.5.4 Custom Sync Rules

Beyond platform optimizations, merchants can add custom rules to any sync:
- Plain-English input via the Feed Assistant (e.g. "Add 'Free Shipping' to titles where price > $75")
- AI converts to a structured rule, shows before/after preview for confirmation
- Confirmed rules are saved with origin "Manual" and appear in the rules panel
- Rules execute after platform optimizations; order matters for chained transforms

#### 5.5.5 Feed Merge (Sync-level)

A sync can include an additional Data Source beyond the primary sources:
- Select a second source to merge in
- Merge strategy: union (add rows) or join (enrich fields using a matching key)
- Useful for adding a promotional feed to one sync without affecting others

*Phase 2:* Source-level column joining (combining fields from two feeds on product ID).

---

### 5.6 Feed Assistant

A persistent chat panel docked at the **bottom of the content area**, always visible, collapsible. The Feed Assistant is the primary interaction surface for data operations — merchants direct it in plain English rather than clicking rows.

**Context-awareness:**
- When viewing a **Data Source** → assistant operates on source-level data quality (pipeline-agnostic)
- When viewing a **Platform Sync** → assistant operates on sync-specific data and knows the platform's spec
- The context (source name or sync name) is shown in the assistant's header bar
- Changes made via the assistant at the sync level never modify the canonical source data

**Structured response format:**

On first load or after a sync run, the assistant presents a structured status report:

> **✓ Applied automatically**
> · [What was fixed, with row counts]
>
> **▲ Needs attention**
> · [Specific issues with counts and inline "Fix now →" action links]
>
> **✦ Recommended next**
> · [Proactive suggestions based on the data]

At the Data Source level, recommendations cover only source-level data quality (missing fields, inconsistent values, formatting issues) — never platform-specific requirements.

At the Platform Sync level, recommendations cover platform spec compliance (GTINs, image resolution, title length limits) and performance improvements (custom labels, category accuracy).

**One-off operations:**
1. Merchant types an instruction in plain English
2. Agent identifies affected rows, generates a preview (count + 5 before/after samples)
3. Merchant confirms ("apply") or cancels
4. Batch update committed; "Save as rule?" prompt offered

**Guardrails:**
- Cannot delete rows or change product IDs
- Changes at the sync level only affect that sync's output — canonical data is never modified from a sync view
- All changes logged with timestamp + instruction (audit trail)
- One-click undo per batch operation

---

### 5.7 Export

- Google Merchant Center: TSV format per GMC spec
- Meta Catalog: CSV format per Meta spec
- On-demand export available any time via "Export feed" button on the sync view
- Background job for large catalogs; download link valid 24 hours
- File naming: `{merchant_id}_{sync_name}_{platform}_{YYYY-MM-DD}.tsv`

---

### 5.8 Sync Schedule

Each Platform Sync runs on its own schedule, independent of the data source refresh:

- **Automatic sync:** every 6h / 12h / 24h (configured per sync at setup time, changeable later)
- On each run: re-fetches canonical data from selected sources, applies all filters and Sync Rules, produces an updated export
- AI optimizations (titles, categories) re-run only if opted in
- Email notification on completion or if new issues are found
- **Manual run:** "Sync now" button on the sync view triggers an ad-hoc run at any time

**Data source refresh** (separate from sync schedule):
- Per Data Source, a merchant can configure a URL and a refresh schedule
- On refresh: re-fetches the source CSV, re-runs the Source Pipeline
- Downstream Platform Syncs pick up the updated canonical data on their next run

---

## 6. Data Model

```
merchants
  id, email, created_at
  brand_voice_instructions (text)

data_sources
  id, merchant_id
  name, original_filename, storage_path, uploaded_at
  column_mapping (jsonb)
  refresh_url (text, nullable)        -- URL to re-fetch source CSV
  refresh_schedule (text, nullable)   -- cron or interval for data source refresh
  pipeline_last_run_at
  pipeline_status (idle|running|done|error)

pipeline_rules
  id, source_id, merchant_id
  label, plain_english
  stage (mapping|dedup|format|quality|validation)
  conditions (jsonb), actions (jsonb)
  enabled (boolean), sort_order (integer)
  created_at, last_run_at, last_match_count
  origin (ai_recommended|user_created|chat)

canonical_products
  id, source_id, merchant_id, row_index
  data (jsonb)
  dedup_status (kept|removed)
  validation_issues (jsonb array)
  updated_at

platform_connections
  id, merchant_id
  platform (google|meta)
  account_id, account_name
  access_token (encrypted), refresh_token (encrypted)
  connected_at, status (active|expired|error)

platform_syncs
  id, merchant_id, connection_id (fk → platform_connections)
  name                               -- e.g. "Summer Footwear"
  platform (google|meta)             -- denormalized for query convenience
  source_ids (jsonb array)           -- primary sources included in this sync
  merge_sources (jsonb array — [{source_id, strategy, key_field}])
  sync_schedule (text)               -- interval: 6h | 12h | 24h
  status (ready|error|processing)
  last_run_at, last_export_at

sync_rules
  id, sync_id, merchant_id
  label, plain_english
  conditions (jsonb), actions (jsonb)
  enabled (boolean), sort_order (integer)
  created_at, last_run_at, last_match_count
  origin (filter|platform_spec|ai_recommended|user_created|chat)
  -- filter rules created during sync setup appear first in the rules panel

sync_products
  id, sync_id, canonical_product_id
  data (jsonb — sync-specific overrides and optimized fields)
  title_optimized, description_optimized
  gpc_suggestion, gpc_confidence (high|medium|low)
  validation_issues (jsonb array)
  enrichment_status (none|pending|applied)
  suppressed (boolean), suppressed_by_rule_id

exports
  id, sync_id, merchant_id
  storage_path, download_url, expires_at
  product_count, status (generating|ready|expired)
  created_at

chat_sessions
  id, merchant_id
  context_type (source|sync), context_id
  created_at

chat_messages
  id, session_id, role (user|assistant), content, created_at

batch_operations
  id, context_type, context_id, instruction
  affected_count, status (preview|applied|undone)
  rule_id (nullable — set if saved as rule)
  created_at, applied_at
```

---

## 7. Out of Scope — Phase 1

- Shopify OAuth / direct API integration
- Hosted feed URLs polled by Google/Meta directly
- Direct push to GMC and Meta via their APIs
- Source-level column joining across feeds (Phase 2)
- Version history and rollback (Phase 2)
- Multi-user workspaces / team accounts
- TikTok, Pinterest, Microsoft feeds
- Image optimization or hosting

---

## 8. Phase 2 Preview

- Shopify OAuth → auto-pull catalog (no CSV needed)
- Hosted feed URLs polled by Google/Meta directly
- Direct push to GMC and Meta via their APIs
- Source-level column joining (product data + inventory feeds joined on product ID)
- Version history + snapshot rollback
- Multi-workspace (agency use case)
- Additional platforms: TikTok, Pinterest, Microsoft

---

## 9. Milestones

| Milestone | Scope |
|---|---|
| M1 | Auth, Data Source upload, field mapping, canonical data model |
| M2 | Source Pipeline — dedup, format standardization, quality fixes |
| M3 | Pipeline recommendations — AI scan, approve/reject, persistent rules |
| M4 | Platform Connections — Google + Meta OAuth, connection management |
| M5 | Platform Syncs — sync setup (name, sources, filter rules, schedule), basic table view |
| M6 | Sync-level optimizations — AI recommendations per platform spec, sync rules |
| M7 | Feed merge at sync level |
| M8 | Feed Assistant — context-aware (source vs sync), structured messages, "save as rule" handoff |
| M9 | Export (Google TSV + Meta CSV), scheduled sync, Inngest jobs, email notifications |

---

## 10. Open Questions

1. **Pricing model** — Freemium (free up to 500 SKUs) vs. pure subscription?
2. **Rule conflict warnings** — When two rules on the same sync modify the same field on the same product, warn the merchant?
3. **GPC taxonomy** — Bundle at deploy time (quarterly refresh) or fetch from Google's public URL on a cron?
4. **Pipeline run granularity** — Does the Source Pipeline run per-source independently, or does updating one source trigger re-evaluation of all downstream syncs?
5. **Chat context switching** — When the merchant navigates to a different source or sync with the chat panel open, does the session follow or reset?
6. **Source issues notice** — When a data source has unresolved issues, should all Platform Syncs that include it show the notice, or only the one currently being viewed?
7. **Sync run on source refresh** — When a data source refreshes (new CSV pulled), should downstream Platform Syncs re-run automatically, or wait for their own scheduled interval?
