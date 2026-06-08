"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Database, Plus, Settings, ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useState } from "react";

export function AppSidebar() {
  const pathname = usePathname();
  const { data: sources } = trpc.dataSource.list.useQuery();
  const { data: syncs } = trpc.sync.list.useQuery();

  // Group syncs by platform
  const googleSyncs = (syncs ?? []).filter((s) => s.platform === "google_shopping");
  const metaSyncs = (syncs ?? []).filter((s) => s.platform === "meta_catalog");

  const [googleExpanded, setGoogleExpanded] = useState(true);
  const [metaExpanded, setMetaExpanded] = useState(true);

  return (
    <aside className="w-60 flex-shrink-0 border-r border-border bg-card flex flex-col h-full">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border">
        <span className="text-base font-semibold text-foreground">FeedMgmt</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {/* Data Sources section */}
        <div className="mb-1">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Data Sources
            </span>
            <Link
              href="/sources/new"
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Add source"
            >
              <Plus className="w-3.5 h-3.5" />
            </Link>
          </div>

          {sources && sources.length > 0 ? (
            sources.map((source) => (
              <NavItem
                key={source.id}
                href={`/sources/${source.id}`}
                active={pathname === `/sources/${source.id}`}
                icon={<Database className="w-3.5 h-3.5" />}
                label={source.name}
              />
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No sources yet</p>
          )}
        </div>

        {/* Platform Syncs section */}
        <div className="mt-4 mb-1">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Platform Syncs
            </span>
          </div>

          {/* Google Shopping */}
          <div>
            <button
              type="button"
              onClick={() => setGoogleExpanded((e) => !e)}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted transition-colors"
            >
              <span className="text-xs font-semibold text-info bg-info/10 px-1.5 py-0.5 rounded flex-shrink-0">G</span>
              <span className="text-sm font-medium text-foreground flex-1 text-left">Google Shopping</span>
              {googleExpanded
                ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
            </button>
            {googleExpanded && (
              <div className="pl-4">
                {googleSyncs.map((sync) => (
                  <NavItem
                    key={sync.id}
                    href={`/syncs/${sync.id}`}
                    active={pathname === `/syncs/${sync.id}`}
                    label={sync.name}
                  />
                ))}
                <Link
                  href="/syncs/new?platform=google_shopping"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-accent rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  New sync
                </Link>
              </div>
            )}
          </div>

          {/* Meta Catalog */}
          <div>
            <button
              type="button"
              onClick={() => setMetaExpanded((e) => !e)}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted transition-colors"
            >
              <span className="text-xs font-semibold text-primary bg-accent px-1.5 py-0.5 rounded flex-shrink-0">M</span>
              <span className="text-sm font-medium text-foreground flex-1 text-left">Meta Catalog</span>
              {metaExpanded
                ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
            </button>
            {metaExpanded && (
              <div className="pl-4">
                {metaSyncs.map((sync) => (
                  <NavItem
                    key={sync.id}
                    href={`/syncs/${sync.id}`}
                    active={pathname === `/syncs/${sync.id}`}
                    label={sync.name}
                  />
                ))}
                <Link
                  href="/syncs/new?platform=meta_catalog"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-accent rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  New sync
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <NavItem
          href="/settings"
          active={pathname === "/settings"}
          icon={<Settings className="w-3.5 h-3.5" />}
          label="Settings"
        />
      </div>
    </aside>
  );
}

function NavItem({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors",
        active
          ? "bg-accent text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground hover:bg-muted font-medium"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}
