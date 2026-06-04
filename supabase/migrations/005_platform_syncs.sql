-- Platform syncs: named, platform-scoped export configurations
create table platform_syncs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('google_shopping', 'meta_catalog')),
  source_ids uuid[] not null default '{}',
  filter_rules jsonb not null default '[]',
  schedule text not null default 'every_12h',
  pipeline_status text not null default 'idle',
  disabled_default_rules text[] not null default '{}',
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add sync_id to pipeline_rules (nullable — source rules use source_id, sync rules use sync_id)
alter table pipeline_rules add column if not exists sync_id uuid references platform_syncs(id) on delete cascade;

create index platform_syncs_merchant_id_idx on platform_syncs(merchant_id);
create index pipeline_rules_sync_id_idx on pipeline_rules(sync_id);

alter table platform_syncs enable row level security;

create policy "platform_syncs: own rows" on platform_syncs
  for all using (auth.uid() = merchant_id);
