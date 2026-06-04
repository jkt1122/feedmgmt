// Platform-specific default rules applied to sync output (after source pipeline).
// Same pattern as defaults.ts: metadata list + apply function.

export type PlatformDefaultRuleMeta = {
  id: string;
  label: string;
  plain_english: string;
  stage: "format" | "quality" | "validation";
  platform: "google_shopping" | "meta_catalog";
};

export const GOOGLE_DEFAULT_RULES: PlatformDefaultRuleMeta[] = [
  {
    id: "google_normalize_availability",
    label: "Normalize availability to Google values",
    plain_english: "Maps availability variants to Google's accepted values: in_stock, out_of_stock, preorder, backorder.",
    stage: "format",
    platform: "google_shopping",
  },
  {
    id: "google_normalize_condition",
    label: "Normalize condition to Google values",
    plain_english: "Maps condition variants to Google's accepted values: new, used, refurbished.",
    stage: "format",
    platform: "google_shopping",
  },
  {
    id: "google_truncate_title",
    label: "Truncate title to 150 characters",
    plain_english: "Google Shopping titles must not exceed 150 characters.",
    stage: "format",
    platform: "google_shopping",
  },
  {
    id: "google_flag_missing_gtin",
    label: "Flag branded products missing GTIN",
    plain_english: "Google requires GTIN for products from brands with known GTINs. Flags products where brand is set but gtin is empty.",
    stage: "validation",
    platform: "google_shopping",
  },
  {
    id: "google_flag_missing_brand",
    label: "Flag products missing brand",
    plain_english: "Google recommends brand for all products.",
    stage: "validation",
    platform: "google_shopping",
  },
  {
    id: "google_flag_short_description",
    label: "Flag products with very short description",
    plain_english: "Google recommends detailed descriptions. Flags products with fewer than 100 characters.",
    stage: "quality",
    platform: "google_shopping",
  },
  {
    id: "google_flag_missing_image",
    label: "Flag products missing image URL",
    plain_english: "Google Shopping requires an image_link for every product.",
    stage: "validation",
    platform: "google_shopping",
  },
];

export const META_DEFAULT_RULES: PlatformDefaultRuleMeta[] = [
  {
    id: "meta_normalize_availability",
    label: "Normalize availability to Meta values",
    plain_english: "Maps availability variants to Meta's accepted values: in stock, out of stock, preorder, available for order.",
    stage: "format",
    platform: "meta_catalog",
  },
  {
    id: "meta_normalize_condition",
    label: "Normalize condition to Meta values",
    plain_english: "Maps condition variants to Meta's accepted values: new, used, refurbished, used_like_new, cpo.",
    stage: "format",
    platform: "meta_catalog",
  },
  {
    id: "meta_truncate_title",
    label: "Truncate title to 150 characters",
    plain_english: "Meta Catalog titles must not exceed 150 characters.",
    stage: "format",
    platform: "meta_catalog",
  },
  {
    id: "meta_truncate_description",
    label: "Truncate description to 9,999 characters",
    plain_english: "Meta Catalog descriptions must not exceed 9,999 characters.",
    stage: "format",
    platform: "meta_catalog",
  },
  {
    id: "meta_flag_missing_brand",
    label: "Flag products missing brand",
    plain_english: "Meta recommends brand for all products for better product matching.",
    stage: "validation",
    platform: "meta_catalog",
  },
  {
    id: "meta_flag_missing_gtin",
    label: "Flag products missing GTIN",
    plain_english: "Meta requires GTIN or MPN for product matching. Flags products missing gtin.",
    stage: "validation",
    platform: "meta_catalog",
  },
  {
    id: "meta_flag_missing_image",
    label: "Flag products missing image URL",
    plain_english: "Meta Catalog requires an image URL for every product.",
    stage: "validation",
    platform: "meta_catalog",
  },
];

export function getPlatformDefaultRules(
  platform: "google_shopping" | "meta_catalog"
): PlatformDefaultRuleMeta[] {
  return platform === "google_shopping" ? GOOGLE_DEFAULT_RULES : META_DEFAULT_RULES;
}

// ── Apply functions ────────────────────────────────────────────────────────────

const GOOGLE_AVAILABILITY_MAP: Record<string, string> = {
  yes: "in_stock", "1": "in_stock", "true": "in_stock",
  available: "in_stock", instock: "in_stock", "in stock": "in_stock",
  "in-stock": "in_stock",
  no: "out_of_stock", "0": "out_of_stock", "false": "out_of_stock",
  "out of stock": "out_of_stock", "out-of-stock": "out_of_stock",
  outofstock: "out_of_stock", "sold out": "out_of_stock", sold_out: "out_of_stock",
  "pre-order": "preorder", pre_order: "preorder",
  backorder: "backorder", "back order": "backorder",
};

const META_AVAILABILITY_MAP: Record<string, string> = {
  in_stock: "in stock", instock: "in stock", "yes": "in stock",
  "1": "in stock", "true": "in stock", available: "in stock",
  out_of_stock: "out of stock", outofstock: "out of stock",
  "no": "out of stock", "0": "out of stock", "false": "out of stock",
  "out-of-stock": "out of stock", "sold out": "out of stock",
  preorder: "preorder", "pre-order": "preorder", pre_order: "preorder",
  backorder: "available for order", "back order": "available for order",
};

const GOOGLE_CONDITION_MAP: Record<string, string> = {
  new: "new", "brand new": "new", NEW: "new", New: "new",
  used: "used", Used: "used", USED: "used",
  "like new": "used", "like-new": "used",
  refurbished: "refurbished", Refurbished: "refurbished", REFURBISHED: "refurbished",
  refurb: "refurbished", reconditioned: "refurbished",
};

const META_CONDITION_MAP: Record<string, string> = {
  new: "new", "brand new": "new", NEW: "new", New: "new",
  used: "used", Used: "used", USED: "used",
  "like new": "used_like_new", "like-new": "used_like_new",
  refurbished: "refurbished", Refurbished: "refurbished", REFURBISHED: "refurbished",
  refurb: "refurbished", reconditioned: "refurbished",
  "certified pre-owned": "cpo", cpo: "cpo",
};

export type PlatformApplyResult = {
  rows: Record<string, string>[];
  issues: { rowIndex: number; field: string; message: string }[];
  matchCounts: Record<string, number>;
};

// Rows coming into this function use canonical field keys (e.g. "title", "price"),
// not source column names. No columnMapping lookup needed.
export function applyPlatformDefaults(
  rows: Record<string, string>[],
  platform: "google_shopping" | "meta_catalog",
  _columnMapping: Record<string, string>,
  disabledRuleIds: string[] = []
): PlatformApplyResult {
  const disabled = new Set(disabledRuleIds);
  const on = (id: string) => !disabled.has(id);
  const rules = getPlatformDefaultRules(platform);
  const counts: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  const issues: { rowIndex: number; field: string; message: string }[] = [];

  // Rows use canonical keys directly
  const titleCol = "title";
  const descCol = "description";
  const brandCol = "brand";
  const availCol = "availability";
  const condCol = "condition";
  const gtinCol = "gtin";
  const imageCol = "image_link";

  const isGoogle = platform === "google_shopping";
  const availMap = isGoogle ? GOOGLE_AVAILABILITY_MAP : META_AVAILABILITY_MAP;
  const condMap = isGoogle ? GOOGLE_CONDITION_MAP : META_CONDITION_MAP;
  const availValid = isGoogle
    ? new Set(["in_stock", "out_of_stock", "preorder", "backorder"])
    : new Set(["in stock", "out of stock", "preorder", "available for order", "discontinued"]);
  const condValid = isGoogle
    ? new Set(["new", "used", "refurbished"])
    : new Set(["new", "used", "refurbished", "used_like_new", "used_good", "used_fair", "cpo"]);

  const result = rows.map((row, rowIndex) => {
    const r = { ...row };

    // normalize availability
    const availId = isGoogle ? "google_normalize_availability" : "meta_normalize_availability";
    if (on(availId)) {
      const val = (r[availCol] ?? "").trim();
      if (val && !availValid.has(val)) {
        const mapped = availMap[val] ?? availMap[val.toLowerCase()];
        if (mapped) { r[availCol] = mapped; counts[availId]++; }
      }
    }

    // normalize condition
    const condId = isGoogle ? "google_normalize_condition" : "meta_normalize_condition";
    if (on(condId)) {
      const val = (r[condCol] ?? "").trim();
      if (val && !condValid.has(val)) {
        const mapped = condMap[val] ?? condMap[val.toLowerCase()];
        if (mapped) { r[condCol] = mapped; counts[condId]++; }
      }
    }

    // truncate title
    const titleTruncId = isGoogle ? "google_truncate_title" : "meta_truncate_title";
    if (on(titleTruncId)) {
      const val = r[titleCol] ?? "";
      if (val.length > 150) {
        r[titleCol] = val.slice(0, 147) + "...";
        counts[titleTruncId]++;
      }
    }

    // meta: truncate description
    if (!isGoogle && on("meta_truncate_description")) {
      const val = r[descCol] ?? "";
      if (val.length > 9999) {
        r[descCol] = val.slice(0, 9996) + "...";
        counts.meta_truncate_description++;
      }
    }

    // flag missing brand
    const brandFlagId = isGoogle ? "google_flag_missing_brand" : "meta_flag_missing_brand";
    if (on(brandFlagId)) {
      if (!r[brandCol] || r[brandCol].trim() === "") {
        issues.push({ rowIndex, field: "brand", message: "Brand is recommended for " + (isGoogle ? "Google Shopping" : "Meta Catalog") });
        counts[brandFlagId]++;
      }
    }

    // flag missing gtin
    const gtinFlagId = isGoogle ? "google_flag_missing_gtin" : "meta_flag_missing_gtin";
    if (on(gtinFlagId)) {
      const hasBrand = (r[brandCol] ?? "").trim() !== "";
      if (hasBrand && (!r[gtinCol] || r[gtinCol].trim() === "")) {
        issues.push({ rowIndex, field: "gtin", message: isGoogle ? "GTIN required for branded products" : "GTIN or MPN required for Meta product matching" });
        counts[gtinFlagId]++;
      }
    }

    // google: flag short description
    if (isGoogle && on("google_flag_short_description")) {
      const val = (r[descCol] ?? "").trim();
      if (val.length > 0 && val.length < 100) {
        issues.push({ rowIndex, field: "description", message: "Description is too short for Google Shopping (< 100 chars)" });
        counts.google_flag_short_description++;
      }
    }

    // flag missing image
    const imageFlagId = isGoogle ? "google_flag_missing_image" : "meta_flag_missing_image";
    if (on(imageFlagId)) {
      if (!r[imageCol] || r[imageCol].trim() === "") {
        issues.push({ rowIndex, field: "image_link", message: "Missing image URL" });
        counts[imageFlagId]++;
      }
    }

    return r;
  });

  return { rows: result, issues, matchCounts: counts };
}
