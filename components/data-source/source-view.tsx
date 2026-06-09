"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CANONICAL_FIELDS } from "@/lib/canonical-fields";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

type DataSource = {
  id: string;
  name: string;
  original_filename: string;
  column_mapping: Record<string, string>;
  pipeline_status: string;
  uploaded_at: string;
  pipeline_last_run_at: string | null;
};

type Product = {
  id: string;
  row_index: number;
  data: Record<string, unknown>;
  dedup_status: string;
  validation_issues: { field: string; message: string }[];
};

export function SourceView({
  source,
  products: initialProducts,
}: {
  source: DataSource;
  products: Product[];
}) {
  const utils = trpc.useUtils();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: fetchedProducts } = trpc.dataSource.getProducts.useQuery(
    { sourceId: source.id },
    { initialData: initialProducts }
  );
  const products = fetchedProducts ?? initialProducts;

  const deleteSource = trpc.dataSource.delete.useMutation({
    onSuccess: async () => {
      await utils.dataSource.list.invalidate();
      router.push("/sources");
    },
  });

  const mappedFields = Object.entries(source.column_mapping ?? {})
    .filter(([, v]) => v)
    .map(([canonical]) => canonical);

  const visibleCanonical = CANONICAL_FIELDS.filter((f) =>
    mappedFields.includes(f.key)
  );
  const rawColumns = Object.keys(products[0]?.data ?? {});

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 pt-5 pb-4 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">{source.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{source.original_filename}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "text-xs font-semibold",
                source.pipeline_status === "done"
                  ? "bg-success/10 text-success border-success/20"
                  : source.pipeline_status === "error"
                  ? "bg-destructive/10 text-destructive border-destructive/20"
                  : "bg-muted text-muted-foreground border-border"
              )}
              variant="outline"
            >
              {source.pipeline_status === "done" ? "imported" : source.pipeline_status}
            </Badge>
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-destructive font-medium">Delete?</span>
                <Button
                  onClick={() => deleteSource.mutate({ id: source.id })}
                  disabled={deleteSource.isPending}
                  className="h-7 text-xs bg-destructive hover:bg-destructive text-primary-foreground font-semibold px-2"
                >
                  {deleteSource.isPending ? "Deleting…" : "Yes, delete"}
                </Button>
                <Button
                  onClick={() => setConfirmDelete(false)}
                  variant="outline"
                  className="h-7 text-xs px-2"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => setConfirmDelete(true)}
                variant="outline"
                className="h-8 text-xs font-semibold gap-1.5 text-destructive hover:text-destructive hover:border-destructive/20"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-3">
          <Stat label="Rows" value={products.length.toLocaleString()} />
          <Stat label="Raw columns" value={rawColumns.length.toLocaleString()} />
          <Stat label="Fields mapped" value={`${mappedFields.length} / ${CANONICAL_FIELDS.length}`} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {products.length === 0 ? (
          <EmptyState />
        ) : (
          <RawTable
            products={products}
            sourceMapping={source.column_mapping}
            visibleCanonical={visibleCanonical}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold font-data text-foreground">{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <p className="text-sm font-semibold text-foreground mb-1">No products yet</p>
      <p className="text-sm text-muted-foreground">
        Rows will appear here after the source file is imported.
      </p>
    </div>
  );
}

function RawTable({
  products,
  sourceMapping,
  visibleCanonical,
}: {
  products: Product[];
  sourceMapping: Record<string, string>;
  visibleCanonical: typeof CANONICAL_FIELDS;
}) {
  const sampleData = products[0]?.data ?? {};
  const columns = Object.keys(sampleData);
  const mappedBySource = new Map(
    visibleCanonical.map((field) => [sourceMapping[field.key], field.label])
  );

  if (columns.length === 0) return <EmptyState />;

  return (
    <div className="overflow-auto h-full">
      <table className="min-w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-muted z-10">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border w-10">
              #
            </th>
            {columns.map((col) => {
              const mappedLabel = mappedBySource.get(col);
              return (
                <th
                  key={col}
                  className={cn(
                    "text-left px-3 py-2 text-xs font-semibold border-b border-border whitespace-nowrap",
                    mappedLabel ? "text-muted-foreground" : "text-muted-foreground/50"
                  )}
                >
                  {col}
                  {mappedLabel && (
                    <span className="ml-1 text-primary/70 font-medium">
                      {mappedLabel}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr
              key={product.id}
              className="border-b border-border hover:bg-accent transition-colors"
            >
              <td className="px-3 py-2 text-xs font-data text-muted-foreground">
                {product.row_index + 1}
              </td>
              {columns.map((col) => {
                const val = String(product.data[col] ?? "");
                return (
                  <td
                    key={col}
                    className="px-3 py-2 text-sm text-foreground max-w-xs truncate"
                    title={val}
                  >
                    {val || <span className="text-muted-foreground/50 text-xs italic">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
