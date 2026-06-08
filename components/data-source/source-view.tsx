"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CANONICAL_FIELDS } from "@/lib/canonical-fields";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { AlertCircle, RefreshCw, Trash2 } from "lucide-react";
import { PipelinePanel } from "./pipeline-panel";
import { FeedChat } from "./feed-chat";

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
  original_data?: Record<string, unknown>;
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
  const [tab, setTab] = useState<"transformed" | "original">("transformed");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: fetchedProducts } = trpc.dataSource.getProducts.useQuery(
    { sourceId: source.id },
    { initialData: initialProducts }
  );
  const products = fetchedProducts ?? initialProducts;

  const invalidateProducts = () => utils.dataSource.getProducts.invalidate({ sourceId: source.id });

  const runPipeline = trpc.dataSource.runPipeline.useMutation({
    onSuccess: invalidateProducts,
  });

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

  const issueCount = products.reduce(
    (n, p) => n + (p.validation_issues?.length ?? 0),
    0
  );

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
            <Button
              onClick={() => runPipeline.mutate({ id: source.id })}
              disabled={runPipeline.isPending || source.pipeline_status === "running"}
              variant="outline"
              className="h-8 text-xs font-semibold gap-1.5"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", runPipeline.isPending && "animate-spin")} />
              {runPipeline.isPending ? "Running…" : "Re-run pipeline"}
            </Button>
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
              {source.pipeline_status}
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
          <Stat label="Products" value={products.length.toLocaleString()} />
          <Stat label="Fields mapped" value={`${mappedFields.length} / ${CANONICAL_FIELDS.length}`} />
          {issueCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-warning">
              <AlertCircle className="w-3.5 h-3.5" />
              <span className="font-semibold">{issueCount} issues</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        className="flex flex-col flex-1 min-h-0"
      >
        <div className="px-6 pt-3 pb-0 flex-shrink-0 border-b border-border">
          <TabsList className="bg-transparent p-0 gap-0 h-auto">
            <TabsTrigger
              value="transformed"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary px-0 mr-6 pb-2.5 pt-0 font-semibold text-sm text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Transformed
            </TabsTrigger>
            <TabsTrigger
              value="original"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary px-0 pb-2.5 pt-0 font-semibold text-sm text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Original
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="transformed" className="flex-1 m-0 p-0 flex flex-col min-h-0 overflow-hidden">
          <PipelinePanel
            sourceId={source.id}
            onRulesApplied={() => runPipeline.mutate({ id: source.id })}
          />
          {products.length === 0 ? (
            <EmptyState />
          ) : (
            <ProductTable
              products={products}
              columns={visibleCanonical}
              getCell={(p, col) => {
                const sourceCol = source.column_mapping[col.key];
                return sourceCol ? String(p.data[sourceCol] ?? "") : "";
              }}
              isTransformed={(p, col) => {
                const sourceCol = source.column_mapping[col.key];
                if (!sourceCol || !p.original_data) return false;
                return String(p.data[sourceCol] ?? "") !== String((p.original_data as Record<string, unknown>)[sourceCol] ?? "");
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="original" className="flex-1 overflow-auto m-0 p-0">
          {products.length === 0 ? (
            <EmptyState />
          ) : (
            <OriginalTable
              products={products}
              sourceMapping={source.column_mapping}
            />
          )}
        </TabsContent>
      </Tabs>

      <FeedChat
        sourceId={source.id}
        onDataChanged={invalidateProducts}
        onRulesApplied={() => runPipeline.mutate({ id: source.id })}
      />
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
        Products will appear here after the source pipeline runs.
      </p>
    </div>
  );
}

function ProductTable({
  products,
  columns,
  getCell,
  isTransformed,
}: {
  products: Product[];
  columns: typeof CANONICAL_FIELDS;
  getCell: (p: Product, col: (typeof CANONICAL_FIELDS)[number]) => string;
  isTransformed?: (p: Product, col: (typeof CANONICAL_FIELDS)[number]) => boolean;
}) {
  return (
    <div className="overflow-auto h-full">
      <table className="min-w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-muted z-10">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border w-10">
              #
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border whitespace-nowrap"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const hasIssues = product.validation_issues?.length > 0;
            return (
              <tr
                key={product.id}
                className={cn(
                  "border-b border-border hover:bg-accent transition-colors",
                  hasIssues && "bg-destructive/10",
                  product.dedup_status === "removed" && "opacity-50"
                )}
              >
                <td className="px-3 py-2 text-xs font-data text-muted-foreground">
                  {product.row_index + 1}
                </td>
                {columns.map((col) => {
                  const val = getCell(product, col);
                  const isDataField = ["id", "price", "sale_price", "gtin", "mpn"].includes(col.key);
                  const transformed = isTransformed?.(product, col) ?? false;
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-2 max-w-xs truncate",
                        isDataField ? "font-data text-xs" : "text-sm",
                        transformed ? "text-success bg-success/10" : "text-foreground"
                      )}
                      title={val}
                    >
                      {val || (
                        <span className="text-muted-foreground/50 text-xs italic">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OriginalTable({
  products,
  sourceMapping,
}: {
  products: Product[];
  sourceMapping: Record<string, string>;
}) {
  // Get all unique source column names from the first product
  const sampleData = products[0]?.data ?? {};
  const columns = Object.keys(sampleData);

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
              const isMapped = Object.values(sourceMapping).includes(col);
              return (
                <th
                  key={col}
                  className={cn(
                    "text-left px-3 py-2 text-xs font-semibold border-b border-border whitespace-nowrap",
                    isMapped ? "text-muted-foreground" : "text-muted-foreground/50"
                  )}
                >
                  {col}
                  {isMapped && (
                    <span className="ml-1 text-primary/60">✓</span>
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
