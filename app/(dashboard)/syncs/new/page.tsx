import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SyncSetupWizard } from "@/components/sync/sync-setup-wizard";

export default async function NewSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const platform = params.platform === "meta_catalog" ? "meta_catalog" : "google_shopping";

  const service = createServiceClient();
  const { data: sources } = await service
    .from("data_sources")
    .select("id, name, pipeline_status")
    .eq("merchant_id", user.id)
    .order("uploaded_at", { ascending: false });

  return (
    <SyncSetupWizard
      platform={platform as "google_shopping" | "meta_catalog"}
      sources={sources ?? []}
    />
  );
}
