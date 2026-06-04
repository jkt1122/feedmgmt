import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSyncPipeline } from "@/lib/pipeline/sync-runner";
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
    .select("*")
    .eq("id", id)
    .eq("merchant_id", user.id)
    .single();

  if (!sync) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await runSyncPipeline({
    serviceClient: service,
    sync: {
      id: sync.id,
      merchant_id: sync.merchant_id,
      platform: sync.platform,
      source_ids: sync.source_ids,
      filter_rules: sync.filter_rules ?? [],
      disabled_default_rules: sync.disabled_default_rules ?? [],
    },
  });

  const content = sync.platform === "google_shopping"
    ? exportGoogleTSV(result.rows, result.columnMapping)
    : exportMetaCSV(result.rows, result.columnMapping);

  const filename = getExportFilename(sync.name, sync.platform);

  return NextResponse.json({ content, filename, rowCount: result.rows.length });
}
