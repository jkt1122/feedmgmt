import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export default async function SourcesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: sources } = await supabase
    .from("data_sources")
    .select("*")
    .eq("merchant_id", user!.id)
    .order("uploaded_at", { ascending: false });

  if (!sources || sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="w-12 h-12 rounded-xl bg-lavender flex items-center justify-center mb-4">
          <Upload className="w-5 h-5 text-electric" />
        </div>
        <h2 className="text-lg font-semibold text-ink mb-1">No data sources yet</h2>
        <p className="text-base text-slate max-w-xs mb-6">
          Upload a product CSV to get started. FeedMgmt will parse your columns and help you map them to a standard format.
        </p>
        <Link
          href="/sources/new"
          className={cn(buttonVariants(), "bg-electric hover:bg-[#6D28D9] text-white font-semibold")}
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload CSV
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink">Data Sources</h1>
        <Link
          href="/sources/new"
          className={cn(buttonVariants(), "bg-electric hover:bg-[#6D28D9] text-white font-semibold")}
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload CSV
        </Link>
      </div>

      <div className="grid gap-3">
        {sources.map((source) => (
          <Link
            key={source.id}
            href={`/sources/${source.id}`}
            className="flex items-center justify-between p-4 bg-white border border-border rounded-lg hover:border-[#CBD5E1] transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-ink">{source.name}</p>
              <p className="text-xs text-slate mt-0.5">{source.original_filename}</p>
            </div>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                source.pipeline_status === "done"
                  ? "bg-green-50 text-green-700"
                  : source.pipeline_status === "error"
                  ? "bg-red-50 text-red-700"
                  : "bg-[#F8FAFC] text-slate"
              }`}
            >
              {source.pipeline_status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
