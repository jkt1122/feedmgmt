"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Database, Plus, Settings } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export function AppSidebar() {
  const pathname = usePathname();
  const { data: sources } = trpc.dataSource.list.useQuery();

  return (
    <aside className="w-60 flex-shrink-0 border-r border-border bg-surface flex flex-col h-full">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border">
        <span className="text-base font-semibold text-ink">FeedMgmt</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {/* Data Sources section */}
        <div className="mb-1">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate">
              Data Sources
            </span>
            <Link
              href="/sources/new"
              className="w-5 h-5 flex items-center justify-center rounded text-slate hover:text-ink hover:bg-surface-2 transition-colors"
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
            <p className="px-2 py-1.5 text-xs text-slate">No sources yet</p>
          )}
        </div>

        {/* Platform Syncs section — coming in M5 */}
        <div className="mt-4 mb-1">
          <div className="px-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate">
              Platform Syncs
            </span>
          </div>
          <div className="px-2 py-1.5">
            <span className="text-xs text-slate">Coming soon</span>
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
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors",
        active
          ? "bg-lavender text-accent-text font-semibold"
          : "text-slate hover:text-ink hover:bg-surface-2 font-medium"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}
