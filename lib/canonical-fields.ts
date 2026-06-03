export type CanonicalField = {
  key: string;
  label: string;
  required: boolean;
  description: string;
  platforms: ("google" | "meta")[];
};

export const CANONICAL_FIELDS: CanonicalField[] = [
  { key: "id", label: "Product ID", required: true, description: "Unique product identifier (SKU, variant ID, etc.)", platforms: ["google", "meta"] },
  { key: "title", label: "Title", required: true, description: "Product name/title", platforms: ["google", "meta"] },
  { key: "description", label: "Description", required: true, description: "Product description", platforms: ["google", "meta"] },
  { key: "link", label: "Product URL", required: true, description: "URL to the product page", platforms: ["google", "meta"] },
  { key: "image_link", label: "Image URL", required: true, description: "Main product image URL", platforms: ["google", "meta"] },
  { key: "additional_image_link", label: "Additional Images", required: false, description: "Additional image URLs (comma-separated)", platforms: ["google", "meta"] },
  { key: "price", label: "Price", required: true, description: "Price with currency (e.g. 29.99 USD)", platforms: ["google", "meta"] },
  { key: "sale_price", label: "Sale Price", required: false, description: "Sale price if discounted", platforms: ["google", "meta"] },
  { key: "availability", label: "Availability", required: true, description: "in_stock, out_of_stock, or preorder", platforms: ["google", "meta"] },
  { key: "condition", label: "Condition", required: true, description: "new, refurbished, or used", platforms: ["google", "meta"] },
  { key: "brand", label: "Brand", required: false, description: "Product brand name", platforms: ["google", "meta"] },
  { key: "gtin", label: "GTIN / Barcode", required: false, description: "UPC, EAN, ISBN, or JAN", platforms: ["google"] },
  { key: "mpn", label: "MPN", required: false, description: "Manufacturer Part Number", platforms: ["google"] },
  { key: "google_product_category", label: "Google Product Category", required: false, description: "Google taxonomy category ID or path", platforms: ["google"] },
  { key: "product_type", label: "Product Type", required: false, description: "Your own category classification", platforms: ["google", "meta"] },
  { key: "custom_label_0", label: "Custom Label 0", required: false, description: "Custom label for Smart Bidding (e.g. margin tier)", platforms: ["google"] },
  { key: "custom_label_1", label: "Custom Label 1", required: false, description: "Custom label 1", platforms: ["google"] },
  { key: "custom_label_2", label: "Custom Label 2", required: false, description: "Custom label 2", platforms: ["google"] },
  { key: "custom_label_3", label: "Custom Label 3", required: false, description: "Custom label 3", platforms: ["google"] },
  { key: "custom_label_4", label: "Custom Label 4", required: false, description: "Custom label 4", platforms: ["google"] },
  { key: "fb_product_category", label: "Meta Product Category", required: false, description: "Meta/Facebook product category", platforms: ["meta"] },
  { key: "item_group_id", label: "Item Group ID", required: false, description: "Groups product variants together", platforms: ["google", "meta"] },
  { key: "color", label: "Color", required: false, description: "Product color", platforms: ["google", "meta"] },
  { key: "size", label: "Size", required: false, description: "Product size", platforms: ["google", "meta"] },
  { key: "gender", label: "Gender", required: false, description: "male, female, or unisex", platforms: ["google", "meta"] },
  { key: "age_group", label: "Age Group", required: false, description: "newborn, infant, toddler, kids, adult", platforms: ["google", "meta"] },
  { key: "material", label: "Material", required: false, description: "Product material", platforms: ["google"] },
  { key: "shipping_weight", label: "Shipping Weight", required: false, description: "Product weight for shipping", platforms: ["google"] },
];

export const REQUIRED_FIELDS = CANONICAL_FIELDS.filter((f) => f.required);

export function suggestMapping(sourceColumns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const aliases: Record<string, string[]> = {
    id: ["id", "productid", "sku", "variantid", "itemid", "pid"],
    title: ["title", "name", "productname", "itemname"],
    description: ["description", "desc", "body", "bodyhtmlstripped", "bodyhtml"],
    link: ["link", "url", "producturl", "pageurl", "handle"],
    image_link: ["imagelink", "image", "imageurl", "mainimage", "featuredimage", "imagesrc"],
    price: ["price", "regularprice", "baseprice"],
    sale_price: ["saleprice", "discountprice", "compareatprice"],
    availability: ["availability", "stock", "inventoryquantity", "instock"],
    condition: ["condition"],
    brand: ["brand", "vendor", "manufacturer"],
    gtin: ["gtin", "upc", "barcode", "ean", "isbn"],
    mpn: ["mpn", "manufacturerpartnumber"],
    product_type: ["producttype", "type", "category", "productcategory"],
    item_group_id: ["itemgroupid", "productid", "parentid", "groupid"],
    color: ["color", "colour"],
    size: ["size"],
    gender: ["gender"],
    age_group: ["agegroup", "age"],
    material: ["material"],
  };

  for (const col of sourceColumns) {
    const normalCol = normalize(col);
    for (const [canonical, patterns] of Object.entries(aliases)) {
      if (patterns.includes(normalCol) && !mapping[canonical]) {
        mapping[canonical] = col;
        break;
      }
    }
  }

  return mapping;
}
