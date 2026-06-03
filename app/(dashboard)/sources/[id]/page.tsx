import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SourceView } from "@/components/data-source/source-view";

export default async function SourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: source } = await supabase
    .from("data_sources")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", user.id)
    .single();

  if (!source) notFound();

  const { data: products } = await supabase
    .from("canonical_products")
    .select("*")
    .eq("source_id", id)
    .order("row_index", { ascending: true })
    .limit(500);

  return <SourceView source={source} products={products ?? []} />;
}
