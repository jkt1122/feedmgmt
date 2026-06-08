// Platform feed export: Google TSV and Meta CSV generators.

const GOOGLE_FIELDS = [
  "id", "title", "description", "link", "image_link",
  "availability", "price", "sale_price", "gtin", "mpn",
  "brand", "condition", "google_product_category", "product_type",
  "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4",
  "shipping", "tax",
];

const META_FIELDS = [
  "id", "title", "description", "availability", "condition",
  "price", "link", "image_link", "brand", "gtin", "mpn",
  "product_type", "sale_price", "additional_image_link",
  "age_group", "color", "gender", "size", "material",
];

function escapeField(val: string, delimiter: "\t" | ","): string {
  if (delimiter === ",") {
    const needsQuote = val.includes(",") || val.includes('"') || val.includes("\n");
    if (needsQuote) return '"' + val.replace(/"/g, '""') + '"';
  }
  // TSV: tabs replaced by spaces (Google spec)
  return val.replace(/\t/g, " ").replace(/\n/g, " ");
}

function buildDelimited(
  rows: Record<string, string>[],
  fields: string[],
  columnMapping: Record<string, string>,
  delimiter: "\t" | ","
): string {
  const lines: string[] = [];
  lines.push(fields.join(delimiter));

  // Build reverse mapping: canonical → source column
  const revMap: Record<string, string> = {};
  for (const [canonical, srcCol] of Object.entries(columnMapping)) {
    revMap[canonical] = srcCol;
  }

  for (const row of rows) {
    const values = fields.map((field) => {
      // Try canonical field directly, then via reverse mapping
      const val = row[field] ?? row[revMap[field] ?? ""] ?? "";
      return escapeField(String(val), delimiter);
    });
    lines.push(values.join(delimiter));
  }

  return lines.join("\n");
}

export function exportGoogleTSV(
  rows: Record<string, string>[],
  columnMapping: Record<string, string>
): string {
  return buildDelimited(rows, GOOGLE_FIELDS, columnMapping, "\t");
}

export function exportMetaCSV(
  rows: Record<string, string>[],
  columnMapping: Record<string, string>
): string {
  return buildDelimited(rows, META_FIELDS, columnMapping, ",");
}

export function getExportFilename(
  syncName: string,
  platform: "google_shopping" | "meta_catalog"
): string {
  const slug = syncName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return platform === "google_shopping"
    ? `${slug}-google-shopping-${date}.tsv`
    : `${slug}-meta-catalog-${date}.csv`;
}
