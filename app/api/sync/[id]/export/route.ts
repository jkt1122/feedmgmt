import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { exportGoogleTSV, exportMetaCSV, getExportFilename } from "@/lib/pipeline/export";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: sync } = await service
    .from("platform_syncs")
    .select("id, name, platform, column_mapping, pipeline_status")
    .eq("id", id)
    .eq("merchant_id", user.id)
    .single();

  if (!sync) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (sync.pipeline_status === "idle") {
    return NextResponse.json({ error: "Run the sync first before exporting." }, { status: 400 });
  }

  const { data: products } = await service
    .from("sync_products")
    .select("data")
    .eq("sync_id", id)
    .eq("merchant_id", user.id)
    .order("row_index", { ascending: true });

  const rows = (products ?? []).map((p) => p.data as Record<string, string>);
  const columnMapping = (sync.column_mapping ?? {}) as Record<string, string>;

  const content = sync.platform === "google_shopping"
    ? exportGoogleTSV(rows, columnMapping)
    : exportMetaCSV(rows, columnMapping);

  const filename = getExportFilename(sync.name, sync.platform);

  return NextResponse.json({ content, filename, rowCount: rows.length });
}
