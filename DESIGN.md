# Design System — FeedMgmt

> Adapted from the Hanno Design System. Color palette, typography (Inter), and brand tokens are Hanno-sourced. Data-density conventions (JetBrains Mono for values, compact table layout, tight component radius) are product-specific additions.

## Product Context
- **What this is:** A web tool for Shopify merchants to manage, clean, enrich, and export product catalog feeds for Google Merchant Center and Meta Catalog
- **Who it's for:** Solo or small-team Shopify merchants running Google Shopping and Meta Advantage+ Catalog campaigns
- **Space/industry:** E-commerce feed management / performance advertising tooling
- **Project type:** Data-heavy SaaS web app — primary surface is a product table with thousands of rows

## Aesthetic Direction
- **Direction:** Precise Utility, Hanno-branded — clean, modern, and highly readable. Built for speed and clarity.
- **Decoration level:** Minimal — subtle purple tones and whitespace carry the brand. No gradients on UI surfaces (hero/marketing only).
- **Mood:** Professional autonomy. The purple signals intelligence and confidence; the tight data layout signals serious tooling.
- **Tagline (Hanno):** Navigate Growth. Autonomously.

## Typography

Hanno uses **Inter** as its primary typeface — clean, modern, highly readable, built for speed and clarity.

- **All headings (H1–H3):** Inter 700 / 600
- **UI labels, nav, buttons:** Inter 600 / 500
- **Body / empty states / onboarding copy:** Inter 400
- **Data values (IDs, prices, SKUs, GTINs):** JetBrains Mono 400–500 — monospace for any value that is data, not a label. Makes the table feel precise.
- **Rule syntax / code:** JetBrains Mono 400

**Note:** Inter is Hanno's defined font — used here per the design system. It's well-suited to data-dense tables at small sizes.

**Loading:**
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**Scale:**
| Token | Size | Weight | Color | Usage |
|-------|------|--------|-------|-------|
| h1 | 32px / -0.03em | 700 | Ink (#0F172A) | Page hero headings |
| h2 | 24px / -0.02em | 700 | Electric Purple (#7C3AED) | Section headings |
| h3 | 18px / -0.01em | 600 | Ink (#0F172A) | Card headings, sub-sections |
| label-lg | 14px | 600 | Ink | Subheadings, table column headers |
| label | 13px | 500 | Ink / Slate | Nav items, form labels |
| label-sm | 11px / uppercase / +0.06em | 600 | Slate (#64748B) | Category labels |
| body | 14px / 1.6 | 400 | Ink | Descriptive copy |
| body-sm | 13px / 1.5 | 400 | Slate | Secondary copy, timestamps |
| mono | 13px | 400–500 | Ink | Data cell values (JetBrains Mono) |
| mono-sm | 11px | 400 | Slate | Rule syntax, secondary data (JetBrains Mono) |

## Color — Hanno Palette

```css
/* ---- Brand purples (Hanno) ---- */
--deep-purple:    #4C1D95;   /* Darkest — logo gradient, deep emphasis */
--electric:       #7C3AED;   /* Primary accent — buttons, active states, H2 headings */
--violet:         #A78BFA;   /* Charts, secondary highlights, icons */
--lavender:       #EDE9FE;   /* Active nav background, selected rows, badge backgrounds */
--mist:           #F5F3FF;   /* Page background tint, subtle section fills */

/* ---- Neutrals (Hanno) ---- */
--ink:            #0F172A;   /* Primary text */
--slate:          #64748B;   /* Muted text, placeholders, section labels */

/* ---- Surfaces ---- */
--bg:             #FFFFFF;   /* Page background */
--surface:        #FFFFFF;   /* Cards, sidebar */
--surface-2:      #F8FAFC;   /* Table header, filter bar, input backgrounds */
--border:         #E2E8F0;   /* All borders */
--border-hover:   #CBD5E1;   /* Focused/hover borders */

/* ---- Accent (maps to Electric Purple) ---- */
--accent:         #7C3AED;
--accent-hover:   #6D28D9;   /* One step darker */
--accent-light:   #EDE9FE;   /* = Lavender */
--accent-text:    #4C1D95;   /* = Deep Purple — text on lavender backgrounds */

/* ---- Semantic states ---- */
--error:          #DC2626;
--error-light:    #FEF2F2;
--error-text:     #991B1B;
--warning:        #D97706;
--warning-light:  #FFFBEB;
--warning-text:   #92400E;
--success:        #16A34A;   /* Growth indicators (green ↑ as in Hanno dashboard) */
--success-light:  #F0FDF4;
--success-text:   #14532D;
--info:           #7C3AED;   /* Use accent for info states to stay on-brand */
--info-light:     #EDE9FE;
--info-text:      #4C1D95;
```

**Dark mode:**
```css
--bg:             #0A0A0F;
--surface:        #0F172A;   /* = Ink becomes surface in dark */
--surface-2:      #1E293B;
--ink:            #F1F5F9;
--slate:          #94A3B8;
--border:         #1E293B;
--electric:       #8B5CF6;   /* Violet-500 — purple desaturated slightly for dark */
--lavender:       #1E1040;
--accent:         #8B5CF6;
--accent-hover:   #7C3AED;
--accent-light:   #1E1040;
--accent-text:    #C4B5FD;
```

**Platform badges:**
```css
.platform-google { background: #EBF5FB; color: #1A73E8; }
.platform-meta   { background: #EDE9FE; color: #4C1D95; }
```

## Spacing

- **Base unit:** 8px (Hanno's dashboard uses 8px rhythm)
- **Density:** Compact-comfortable. Table row height 40px standard / 32px compact mode.

| Token | Value | Usage |
|-------|-------|-------|
| 2xs | 4px | Icon gaps, badge padding |
| xs | 8px | Label to input, tight gaps |
| sm | 12px | Cell padding, nav item padding |
| md | 16px | Card padding, section gaps |
| lg | 24px | Between card groups |
| xl | 32px | Page-level vertical rhythm |
| 2xl | 48px | Section breaks |
| 3xl | 64px | Hero / empty state spacing |

## Layout

- **Approach:** Grid-disciplined — strict columns, predictable alignment
- **Sidebar:** Fixed 240px — matches Hanno dashboard sidebar width
- **Content area:** Flex-grows to fill remaining viewport
- **Right drawer:** 380px — product detail, chat, field mapping
- **Topbar height:** 56px (slightly taller than original — matches Hanno app header)
- **Filter bar height:** 40px
- **Table row height:** 40px standard, 32px compact

**Breakpoints:** Desktop-first. Minimum supported: 1024px. No mobile Phase 1.

## Border Radius — Hanno-Calibrated

Hanno uses moderate radius — more generous than pure utility, less bubbly than consumer apps.

| Token | Value | Usage |
|-------|------|-------|
| sm | 4px | Badges, table status pills |
| md | 8px | Buttons, form inputs, filter tabs |
| lg | 12px | Cards, panels, modals |
| xl | 16px | Sidebar nav active item (pill style, as in Hanno dashboard) |
| full | 9999px | Toggle switches |

## Motion — Minimal Functional

- **Easing:** enter: ease-out / exit: ease-in / move: ease-in-out
- **Duration:**
  - micro: 100ms — hover states, checkbox checks
  - short: 150ms — dropdown open, tooltip
  - medium: 200ms — sidebar collapse, drawer open
  - long: 300ms — modal appear

## Component Conventions

**Buttons (Hanno style):**
- Primary: `--electric` background (#7C3AED), white text, 8px radius
- Secondary: white background, `--border` border, ink text
- Ghost: transparent, slate text
- Border radius: 8px (md)
- Font: Inter 600, 14px, 8px vertical / 20px horizontal padding
- Icon + label gap: 8px

**Active nav item (Hanno dashboard style):**
- Background: `--lavender` (#EDE9FE)
- Text: `--accent-text` (#4C1D95), Inter 600
- Border radius: 16px (pill, as seen in Hanno sidebar)

**Stat cards (Hanno dashboard style):**
- White surface, 1px border, 12px radius
- Metric value: Inter 700, 28px, Ink
- Growth indicator: success green (#16A34A) with ↑ arrow (matches Hanno dashboard)
- Label: Inter 500, 12px, Slate

**Badges:**
- Pill shape (border-radius: 100px)
- Inter 600, 11px
- AI enrichment: lavender background (#EDE9FE), deep-purple text (#4C1D95)

**Table:**
- Sticky header, surface-2 background
- Selected rows: lavender (#EDE9FE) background
- Error rows: error-light background
- Data values (IDs, prices, SKUs): JetBrains Mono — our product-specific addition
- H2-style electric purple for active section counts

**Forms:**
- Border: 1px solid `--border`
- Focus: border switches to `--electric` + 3px purple ring (12% opacity)
- Monospace inputs for product IDs, rule syntax
- Label: Inter 600, 12px

## Design Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-02 | Adopted Hanno Design System | User-specified foundation — color palette, Inter typography, and brand tokens |
| 2026-06-02 | Electric Purple (#7C3AED) as primary accent | Hanno's defined brand accent — replaces original teal |
| 2026-06-02 | Inter as primary typeface | Hanno's defined font — clean, modern, highly readable, built for speed and clarity |
| 2026-06-02 | JetBrains Mono for data values | Product-specific addition not in Hanno — makes IDs, prices, SKUs, GTINs feel precise |
| 2026-06-02 | Lavender (#EDE9FE) for active/selected states | Directly from Hanno's nav active state and badge backgrounds |
| 2026-06-02 | 8px border radius for buttons/inputs | Hanno uses more generous radius than pure utility — matches dashboard components |
| 2026-06-02 | Success green (#16A34A) for growth indicators | Matches Hanno dashboard's ↑ growth arrows |
| 2026-06-02 | Dark mode: electric shifts to #8B5CF6 | Desaturation keeps purple readable on dark surfaces |

## Tailwind Config Mapping

```js
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        // Hanno brand purples
        'deep-purple': '#4C1D95',
        electric:      '#7C3AED',
        violet:        '#A78BFA',
        lavender:      '#EDE9FE',
        mist:          '#F5F3FF',
        // Hanno neutrals
        ink:   '#0F172A',
        slate: '#64748B',
        // Semantic
        accent: { DEFAULT: '#7C3AED', hover: '#6D28D9', light: '#EDE9FE', text: '#4C1D95' },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        sm: '4px', DEFAULT: '8px', md: '8px', lg: '12px', xl: '16px',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs:   ['11px', { lineHeight: '16px' }],
        sm:   ['12px', { lineHeight: '16px' }],
        base: ['13px', { lineHeight: '20px' }],
        md:   ['14px', { lineHeight: '22px' }],
        lg:   ['18px', { lineHeight: '26px' }],
        xl:   ['24px', { lineHeight: '32px' }],
        '2xl':['32px', { lineHeight: '40px' }],
      },
    },
  },
}
```
