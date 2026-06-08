# Design System

Use Shadcn components as the base implementation.

Do not hardcode colors. Use semantic Tailwind classes:
- bg-background
- text-foreground
- bg-card
- text-card-foreground
- bg-primary
- text-primary-foreground
- border-border

Do not invent new button styles.

Use these components first:
- Button
- Card
- Input
- Label
- Textarea
- Select
- Dialog
- Sheet
- Tabs
- Table
- Badge

When creating product-specific components, compose them from Shadcn primitives.

## Adding Shadcn components (IMPORTANT)

This project runs **Tailwind v3.4** (`@tailwind base/components/utilities` directives,
colors in `tailwind.config.ts`). But `npx shadcn@latest add <component>` pulls the
**Tailwind v4** registry, which emits v4-only syntax that **breaks silently** on v3:

- `py-(--card-spacing)` / `gap-(--var)` — v4 CSS-variable shorthand (v3 needs `py-[var(--x)]`)
- `[--card-spacing:--spacing(4)]` — the `--spacing()` function is v4-only, so the var
  never resolves and the element renders with **zero padding**
- `@container/...`, `field-sizing-content`, `*:[...]` child shorthand, `ring-3`

So after every `shadcn add`, reconcile the generated file to v3:
- replace `p*-(--var)` + `--spacing(n)` with concrete utilities (`p-4`, `px-4`, `gap-4`, …)
- replace `*:[img:first-child]:` with `[&>img:first-child]:`
- drop `@container` / `field-sizing` (or add the relevant plugin)
- `ring-3` is invalid in v3 (no-op) — fine to leave, matches existing components

Tokens are **oklch** and referenced via `var(--x)` (not `hsl(var(--x))`). Components
use `@base-ui/react` primitives and do **not** support `asChild` — use `buttonVariants()`
+ a `Link`/element directly instead.

(If the project later migrates to Tailwind v4, this whole reconciliation step goes away.)
