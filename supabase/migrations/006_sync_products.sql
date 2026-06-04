-- Persisted sync pipeline output: written on every sync run, read on page load.
-- Avoids re-running the full pipeline on every getProducts call.
create table sync_products (
  id uuid primary key default gen_random_uuid(),
  sync_id uuid not null references platform_syncs(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  row_index integer not null,
  data jsonb not null default '{}',
  pre_transform_data jsonb not null default '{}',
  validation_issues jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index sync_products_sync_id_idx on sync_products(sync_id);
create index sync_products_merchant_id_idx on sync_products(merchant_id);

alter table sync_products enable row level security;

create policy "sync_products: own rows" on sync_products
  for all using (auth.uid() = merchant_id);

-- Add column_mapping snapshot to platform_syncs so getProducts doesn't need to re-fetch sources
alter table platform_syncs add column if not exists column_mapping jsonb not null default '{}';
alter table platform_syncs add column if not exists last_product_count integer;
alter table platform_syncs add column if not exists last_filtered_out integer;
