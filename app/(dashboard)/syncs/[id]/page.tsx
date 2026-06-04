import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SyncView } from "@/components/sync/sync-view";

export default async function SyncPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const service = createServiceClient();

  const { data: sync } = await service
    .from("platform_syncs")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", user.id)
    .single();

  if (!sync) notFound();

  return <SyncView sync={sync} />;
}
