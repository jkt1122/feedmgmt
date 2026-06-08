"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { RefreshCw, Download, AlertTriangle, X, Trash2, Settings } from "lucide-react";
import { CANONICAL_FIELDS } from "@/lib/canonical-fields";
import { SyncRulesPanel } from "./sync-rules-panel";
import { SyncChat } from "./sync-chat";
import { SyncEditDialog } from "./sync-edit-dialog";

type PlatformSync = {
  id: string;
  name: string;
  platform: "google_shopping" | "meta_catalog";
  source_ids: string[];
  filter_rules: unknown[];
  pipeline_status: string;
  last_run_at: string | null;
  column_mapping: Record<string, string>;
  last_product_count: number | null;
  last_filtered_out: number | null;
  recommendations_seen: boolean;
};

export function SyncView({ sync: initialSync }: { sync: PlatformSync }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [sync, setSync] = useState(initialSync);
  const [issueBannerDismissed, setIssueBannerDismissed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: productsData, refetch: refetchProducts } = trpc.sync.getProducts.useQuery({ id: sync.id });
  const { data: sourceIssues = [] } = trpc.sync.getSourceIssues.useQuery({ syncId: sync.id });

  const runSync = trpc.sync.run.useMutation({
    onSuccess: () => {
      utils.sync.get.invalidate({ id: sync.id });
      utils.sync.getRules.invalidate({ syncId: sync.id });
      utils.sync.getRecommendations.invalidate({ syncId: sync.id });
      refetchProducts();
    },
  });

  const deleteSync = trpc.sync.delete.useMutation({
    onSuccess: async () => {
      await utils.sync.list.invalidate();
      router.push("/sources");
    },
  });

  const handleExport = async () => {
    const resp = await fetch(`/api/sync/${sync.id}/export`);
    if (!resp.ok) return;
    const { content, filename } = await resp.json();
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const platformLabel = sync.platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";
  const rows: Record<string, string>[] = productsData?.rows ?? [];
  const preTransformRows: Record<string, string>[] = productsData?.preTransformRows ?? [];
  const totalRows = productsData?.totalRows ?? sync.last_product_count ?? 0;
  const filteredOut = productsData?.filteredOutCount ?? sync.last_filtered_out ?? 0;
  const neverRun = productsData?.neverRun ?? sync.pipeline_status === "idle";

  const columnMapping = productsData?.columnMapping ?? sync.column_mapping ?? {};
  const visibleFields = CANONICAL_FIELDS.filter((f) => columnMapping[f.key]);

  const lastRun = sync.last_run_at
    ? new Date(sync.last_run_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
      new Date(sync.last_run_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div className="h-13 border-b border-border bg-card flex items-center px-6 gap-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {sync.name}
            <span className={cn(
              "text-xs font-bold px-1.5 py-0.5 rounded",
              sync.platform === "google_shopping" ? "bg-blue-50 text-blue-700" : "bg-accent text-deep"
            )}>
              {platformLabel}
            </span>
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {neverRun
              ? "Not yet run"
              : `~${totalRows.toLocaleString()} products${filteredOut > 0 ? ` · ${filteredOut.toLocaleString()} filtered out` : ""}${lastRun ? ` · synced ${lastRun}` : ""}`
            }
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
          >
            <Settings className="w-3 h-3" />
            Edit setup
          </button>
          <button
            type="button"
            onClick={() => runSync.mutate({ id: sync.id })}
            disabled={runSync.isPending}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", runSync.isPending && "animate-spin")} />
            {runSync.isPending ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={neverRun}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors",
              neverRun
                ? "bg-border text-muted-foreground cursor-not-allowed"
                : "bg-primary text-white hover:bg-primary/90"
            )}
          >
            <Download className="w-3 h-3" />
            Export feed
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 text-muted-foreground hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            title="Delete sync"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Source issues banner (wired to real data) */}
      {!issueBannerDismissed && sourceIssues.length > 0 && (
        <div className="flex items-center gap-3 px-5 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-xs text-amber-900 flex-1">
            {sourceIssues.map((src, i) => (
              <span key={src.sourceId}>
                {i > 0 && " · "}
                <strong>{src.sourceName}</strong> has{" "}
                <strong>{src.count.toLocaleString()} products</strong> with issues
                {src.sample.length > 0 && ` (${src.sample.slice(0, 2).join(", ")})`}
              </span>
            ))}
            {" · "}
            <a href="/sources" className="font-semibold underline">Review in data sources →</a>
          </span>
          <button type="button" onClick={() => setIssueBannerDismissed(true)} className="text-amber-600 hover:text-amber-800 p-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Rules panel — accepted/custom rules */}
      <SyncRulesPanel
        syncId={sync.id}
        platform={sync.platform}
        disabledDefaultRules={[]}
        onRulesChanged={() => runSync.mutate({ id: sync.id })}
      />

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        {neverRun ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <div className="text-3xl opacity-20">📦</div>
            <p className="text-sm font-medium text-foreground">Sync has not run yet</p>
            <p className="text-xs text-muted-foreground">Run the sync to process your sources and see the platform-ready feed.</p>
            <button
              type="button"
              onClick={() => runSync.mutate({ id: sync.id })}
              disabled={runSync.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-primary px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3 h-3", runSync.isPending && "animate-spin")} />
              {runSync.isPending ? "Running…" : "Run sync now"}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <p className="text-sm">No products matched your filter rules.</p>
          </div>
        ) : (
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-background z-10">
              <tr>
                <th className="w-9 px-3 py-2 text-left border-b border-border">
                  <input type="checkbox" className="accent-primary w-3 h-3" />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border whitespace-nowrap">
                  #
                </th>
                {visibleFields.map((f) => (
                  <th key={f.key} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border whitespace-nowrap">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const pre = preTransformRows[i] ?? {};
                const issues = (productsData?.issuesByRow as Record<string, { field: string; message: string }[]>)?.[String(i)];
                const issueFields = new Set((issues ?? []).map((e) => e.field));
                return (
                  <tr key={i} className={cn(
                    "border-b border-border hover:bg-accent transition-colors",
                    issues && issues.length > 0 && "bg-red-50/30"
                  )}>
                    <td className="px-3 h-9"><input type="checkbox" className="accent-primary w-3 h-3" /></td>
                    <td className="px-3 h-9 text-xs text-muted-foreground font-mono">{i + 1}</td>
                    {visibleFields.map((f) => {
                      const val = row[f.key] ?? "";
                      const preVal = pre[f.key] ?? "";
                      const isDataField = ["id", "price", "sale_price", "gtin", "mpn"].includes(f.key);
                      const changed = val !== preVal && preVal !== "";
                      const hasFieldIssue = issueFields.has(f.key);
                      return (
                        <td
                          key={f.key}
                          className={cn(
                            "px-3 h-9 max-w-xs truncate",
                            isDataField ? "font-mono text-xs" : "text-sm",
                            hasFieldIssue ? "text-red-700 bg-red-50/60"
                              : changed ? "text-green-700 bg-green-50/60"
                              : "text-foreground"
                          )}
                          title={val || undefined}
                        >
                          {val || <span className="text-muted-foreground/40 italic text-xs">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Feed Assistant */}
      <SyncChat
        syncId={sync.id}
        syncName={sync.name}
        platform={sync.platform}
        recommendationsSeen={sync.recommendations_seen}
        onRulesChanged={() => runSync.mutate({ id: sync.id })}
      />

      {/* Edit dialog */}
      {editOpen && (
        <SyncEditDialog
          sync={sync}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setSync({ ...sync, ...updated });
            setEditOpen(false);
            runSync.mutate({ id: sync.id });
          }}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-foreground mb-1">Delete sync?</h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              <strong>&ldquo;{sync.name}&rdquo;</strong> and all its optimizations will be permanently deleted.
              Your source data is not affected.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-sm font-medium text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg border border-border hover:bg-background transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteSync.mutate({ id: sync.id })}
                disabled={deleteSync.isPending}
                className="text-sm font-semibold text-destructive-foreground bg-destructive hover:opacity-90 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {deleteSync.isPending ? "Deleting…" : "Delete sync"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
