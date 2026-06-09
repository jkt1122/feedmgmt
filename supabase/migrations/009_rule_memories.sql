-- Accepted/rejected proposal memory. The first product scope is sync-level.
create table if not exists rule_memories (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  sync_id uuid references platform_syncs(id) on delete cascade,
  platform text check (platform in ('google_shopping', 'meta_catalog')),
  scope text not null default 'sync' check (scope in ('sync')),
  decision text not null check (decision in ('accepted', 'rejected')),
  fingerprint text not null,
  origin text not null check (origin in ('basic_fix', 'platform_spec', 'agent_reasoned', 'user_request')),
  rule_spec jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists rule_memories_sync_fingerprint_decision_idx
  on rule_memories(merchant_id, sync_id, fingerprint, decision);

create index if not exists rule_memories_sync_lookup_idx
  on rule_memories(merchant_id, sync_id, fingerprint);

alter table rule_memories enable row level security;

create policy "rule_memories: own rows" on rule_memories
  for all using (auth.uid() = merchant_id);
