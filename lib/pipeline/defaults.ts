// Default global transformations applied to every feed before user rules.
// Defined in terms of canonical field names; mapped to source columns at runtime.

export type DefaultRuleMeta = {
  id: string;
  label: string;
  plain_english: string;
  stage: "format" | "quality" | "validation";
  canonicalFields: string[];
};

// Ordered list — used for UI display in the pipeline strip
export const DEFAULT_RULES: DefaultRuleMeta[] = [
  {
    id: "trim_text",
    label: "Trim whitespace from text fields",
    plain_english: "Removes leading and trailing spaces, tabs, and newlines from title, description, and brand.",
    stage: "format",
    canonicalFields: ["title", "description", "brand"],
  },
  {
    id: "strip_html",
    label: "Strip HTML tags from text fields",
    plain_english: "Removes HTML tags and decodes common HTML entities in title and description.",
    stage: "format",
    canonicalFields: ["title", "description"],
  },
  {
    id: "normalize_availability",
    label: "Normalize availability values",
    plain_english: "Maps common variants (yes, 1, available, in stock…) to standard values: in_stock, out_of_stock, preorder.",
    stage: "format",
    canonicalFields: ["availability"],
  },
  {
    id: "normalize_condition",
    label: "Normalize condition values",
    plain_english: "Maps common variants (NEW, Like New…) to standard values: new, used, refurbished.",
    stage: "format",
    canonicalFields: ["condition"],
  },
  {
    id: "normalize_price",
    label: "Normalize price format",
    plain_english: "Formats price and sale_price to 2 decimal places, removing stray currency symbols.",
    stage: "format",
    canonicalFields: ["price", "sale_price"],
  },
  {
    id: "flag_missing_required",
    label: "Flag missing required fields",
    plain_english: "Adds a validation issue for any product missing title, price, availability, or condition.",
    stage: "validation",
    canonicalFields: ["title", "price", "availability", "condition"],
  },
  {
    id: "flag_sale_price_invalid",
    label: "Flag invalid sale price",
    plain_english: "Adds a validation issue when sale_price is higher than price.",
    stage: "validation",
    canonicalFields: ["price", "sale_price"],
  },
  {
    id: "flag_missing_image",
    label: "Flag missing image URL",
    plain_english: "Adds a validation issue for any product with no image link.",
    stage: "validation",
    canonicalFields: ["image_link"],
  },
];

const AVAILABILITY_MAP: Record<string, string> = {
  yes: "in_stock", "1": "in_stock", "true": "in_stock",
  available: "in_stock", instock: "in_stock", "in stock": "in_stock",
  no: "out_of_stock", "0": "out_of_stock", "false": "out_of_stock",
  unavailable: "out_of_stock", outofstock: "out_of_stock",
  "out of stock": "out_of_stock", sold_out: "out_of_stock", "sold out": "out_of_stock",
  "pre-order": "preorder", pre_order: "preorder", backorder: "preorder",
};

const CONDITION_MAP: Record<string, string> = {
  new: "new", "brand new": "new", NEW: "new",
  used: "used", "like new": "used", "like-new": "used",
  good: "used", fair: "used", acceptable: "used",
  refurbished: "refurbished", "re-furbished": "refurbished", reconditioned: "refurbished",
};

const REQUIRED_CANONICAL = ["title", "price", "availability", "condition", "image_link"];

function stripHtml(val: string): string {
  return val
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function sanitizeText(val: string): string {
  return val.replace(/[\r\n\t]+/g, " ").trim();
}

function normalizePrice(val: string): string {
  // Strip currency symbols and whitespace, keep digits and decimal
  const raw = val.replace(/[^0-9.]/g, "");
  const num = parseFloat(raw);
  return isNaN(num) ? val : num.toFixed(2);
}

export type DefaultApplyResult = {
  rows: Record<string, string>[];
  issues: { rowIndex: number; field: string; message: string }[];
  matchCounts: Record<string, number>;
};

export function applyDefaultTransformations(
  rows: Record<string, string>[],
  columnMapping: Record<string, string>,
  disabledRuleIds: string[] = []
): DefaultApplyResult {
  const disabled = new Set(disabledRuleIds);
  const on = (id: string) => !disabled.has(id);
  const counts: Record<string, number> = Object.fromEntries(DEFAULT_RULES.map((r) => [r.id, 0]));
  const issues: { rowIndex: number; field: string; message: string }[] = [];

  // Build reverse: source column → canonical
  const colFor = (canonical: string) => columnMapping[canonical] ?? null;

  const titleCol = colFor("title");
  const descCol = colFor("description");
  const brandCol = colFor("brand");
  const availCol = colFor("availability");
  const condCol = colFor("condition");
  const priceCol = colFor("price");
  const salePriceCol = colFor("sale_price");
  const imageCol = colFor("image_link");

  const result = rows.map((row, rowIndex) => {
    const r = { ...row };

    // 1. Trim + sanitize text fields
    if (on("trim_text")) {
      for (const col of [titleCol, descCol, brandCol]) {
        if (!col) continue;
        const before = r[col] ?? "";
        const after = sanitizeText(before);
        if (after !== before) { r[col] = after; counts.trim_text++; }
      }
    }

    // 2. Strip HTML from title + description
    if (on("strip_html")) {
      for (const col of [titleCol, descCol]) {
        if (!col) continue;
        const before = r[col] ?? "";
        const after = stripHtml(before);
        if (after !== before) { r[col] = after; counts.strip_html++; }
      }
    }

    // 3. Normalize availability
    if (on("normalize_availability") && availCol) {
      const val = (r[availCol] ?? "").trim();
      const valid = new Set(["in_stock", "out_of_stock", "preorder"]);
      if (!valid.has(val)) {
        const mapped = AVAILABILITY_MAP[val.toLowerCase()];
        if (mapped) { r[availCol] = mapped; counts.normalize_availability++; }
      }
    }

    // 4. Normalize condition
    if (on("normalize_condition") && condCol) {
      const val = (r[condCol] ?? "").trim();
      const valid = new Set(["new", "used", "refurbished"]);
      if (!valid.has(val)) {
        const mapped = CONDITION_MAP[val.toLowerCase()] ?? CONDITION_MAP[val];
        if (mapped) { r[condCol] = mapped; counts.normalize_condition++; }
      }
    }

    // 5. Normalize price format
    if (on("normalize_price")) {
      for (const col of [priceCol, salePriceCol]) {
        if (!col) continue;
        const before = r[col] ?? "";
        if (!before.trim()) continue;
        const after = normalizePrice(before);
        if (after !== before) { r[col] = after; counts.normalize_price++; }
      }
    }

    // 6. Flag missing required fields
    if (on("flag_missing_required")) {
      for (const canonical of REQUIRED_CANONICAL) {
        const col = colFor(canonical);
        if (!col) continue;
        if (!r[col] || r[col].trim() === "") {
          issues.push({ rowIndex, field: canonical, message: `Missing required field: ${canonical}` });
          counts.flag_missing_required++;
        }
      }
    }

    // 7. Flag sale_price > price
    if (on("flag_sale_price_invalid") && priceCol && salePriceCol) {
      const price = parseFloat((r[priceCol] ?? "").replace(/[^0-9.]/g, ""));
      const salePrice = parseFloat((r[salePriceCol] ?? "").replace(/[^0-9.]/g, ""));
      if (!isNaN(price) && !isNaN(salePrice) && salePrice > price) {
        issues.push({ rowIndex, field: "sale_price", message: "Sale price is higher than regular price" });
        counts.flag_sale_price_invalid++;
      }
    }

    // 8. Flag missing image
    if (on("flag_missing_image") && imageCol) {
      if (!r[imageCol] || r[imageCol].trim() === "") {
        issues.push({ rowIndex, field: "image_link", message: "Missing image URL" });
        counts.flag_missing_image++;
      }
    }

    return r;
  });

  return { rows: result, issues, matchCounts: counts };
}
