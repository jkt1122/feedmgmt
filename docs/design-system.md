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
