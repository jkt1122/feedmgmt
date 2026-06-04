"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { RefreshCw, Download, AlertTriangle, X } from "lucide-react";
import { CANONICAL_FIELDS } from "@/lib/canonical-fields";
import { SyncRulesPanel } from "./sync-rules-panel";
import { SyncChat } from "./sync-chat";

type PlatformSync = {
  id: string;
  name: string;
  platform: "google_shopping" | "meta_catalog";
  source_ids: string[];
  filter_rules: unknown[];
  schedule: string;
  pipeline_status: string;
  last_run_at: string | null;
  disabled_default_rules: string[];
};

export function SyncView({ sync }: { sync: PlatformSync }) {
  const utils = trpc.useUtils();
  const [issueBannerDismissed, setIssueBannerDismissed] = useState(false);

  const { data: productsData, refetch: refetchProducts } = trpc.sync.getProducts.useQuery(
    { id: sync.id },
    { enabled: true }
  );

  const runSync = trpc.sync.run.useMutation({
    onSuccess: () => {
      utils.sync.get.invalidate({ id: sync.id });
      refetchProducts();
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
  const issueCount = productsData ? Object.keys(productsData.issuesByRow).length : 0;
  const totalRows = productsData?.totalRows ?? 0;
  const filteredOut = productsData?.filteredOutCount ?? 0;

  const lastRun = sync.last_run_at
    ? new Date(sync.last_run_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
      new Date(sync.last_run_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : "Never";

  // All canonical fields that have a mapped column in this sync's sources
  const columnMapping = productsData?.columnMapping ?? {};
  const visibleFields = CANONICAL_FIELDS.filter((f) => columnMapping[f.key]);

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div className="h-13 border-b border-border bg-surface flex items-center px-6 gap-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            {sync.name}
            <span className={cn(
              "text-xs font-bold px-1.5 py-0.5 rounded",
              sync.platform === "google_shopping"
                ? "bg-blue-50 text-blue-700"
                : "bg-lavender text-deep"
            )}>
              {platformLabel}
            </span>
          </div>
          <div className="text-xs text-slate font-mono mt-0.5">
            {totalRows > 0 ? `~${totalRows.toLocaleString()} products` : "—"}
            {filteredOut > 0 && ` · ${filteredOut.toLocaleString()} filtered out`}
            {sync.last_run_at && ` · synced ${lastRun}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => runSync.mutate({ id: sync.id })}
            disabled={runSync.isPending}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-background text-slate hover:text-ink hover:bg-surface transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", runSync.isPending && "animate-spin")} />
            {runSync.isPending ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-electric text-white hover:bg-electric/90 transition-colors"
          >
            <Download className="w-3 h-3" />
            Export feed
          </button>
        </div>
      </div>

      {/* Issue banner */}
      {!issueBannerDismissed && issueCount > 0 && (
        <div className="flex items-center gap-3 px-5 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-xs text-amber-900 flex-1">
            <strong>{issueCount.toLocaleString()} products</strong> have platform-specific issues (missing fields, spec violations) that may affect feed approval.
          </span>
          <button
            type="button"
            onClick={() => setIssueBannerDismissed(true)}
            className="text-amber-600 hover:text-amber-800 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Rules panel */}
      <SyncRulesPanel
        syncId={sync.id}
        platform={sync.platform}
        disabledDefaultRules={sync.disabled_default_rules ?? []}
        onRulesChanged={() => refetchProducts()}
      />

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate">
            <div className="text-3xl opacity-20">📦</div>
            <p className="text-sm">No products yet — run the sync to process your sources.</p>
            <button
              type="button"
              onClick={() => runSync.mutate({ id: sync.id })}
              className="text-xs font-semibold text-electric hover:underline"
            >
              Run sync now →
            </button>
          </div>
        ) : (
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-background z-10">
              <tr>
                <th className="w-9 px-3 py-2 text-left border-b border-border">
                  <input type="checkbox" className="accent-electric w-3 h-3" />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate uppercase tracking-wide border-b border-border whitespace-nowrap">
                  #
                </th>
                {visibleFields.map((f) => (
                  <th key={f.key} className="px-3 py-2 text-left text-xs font-semibold text-slate uppercase tracking-wide border-b border-border whitespace-nowrap">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const pre = preTransformRows[i] ?? {};
                const issues = (productsData?.issuesByRow as Record<string, { field: string; message: string }[]>)?.[String(i)];
                const hasIssues = issues && issues.length > 0;
                const issueFields = new Set((issues ?? []).map((e) => e.field));
                return (
                  <tr key={i} className={cn(
                    "border-b border-border hover:bg-mist transition-colors",
                    hasIssues && "bg-red-50/30"
                  )}>
                    <td className="px-3 h-9">
                      <input type="checkbox" className="accent-electric w-3 h-3" />
                    </td>
                    <td className="px-3 h-9 text-xs text-slate font-mono">{i + 1}</td>
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
                            hasFieldIssue
                              ? "text-red-700 bg-red-50/60"
                              : changed
                              ? "text-green-700 bg-green-50/60"
                              : "text-ink"
                          )}
                          title={val || undefined}
                        >
                          {val || <span className="text-slate/40 italic text-xs">—</span>}
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
        onRulesChanged={() => refetchProducts()}
      />
    </div>
  );
}
