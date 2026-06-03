-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Merchants (maps 1:1 to auth.users)
create table merchants (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  brand_voice_instructions text,
  created_at timestamptz default now()
);

-- Auto-create merchant row on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into merchants (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Data Sources
create table data_sources (
  id uuid primary key default uuid_generate_v4(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null,
  original_filename text not null,
  storage_path text not null,
  uploaded_at timestamptz default now(),
  column_mapping jsonb default '{}'::jsonb,
  refresh_url text,
  refresh_schedule text,
  pipeline_last_run_at timestamptz,
  pipeline_status text not null default 'idle'
    check (pipeline_status in ('idle', 'running', 'done', 'error'))
);

create index data_sources_merchant_id_idx on data_sources(merchant_id);

-- Canonical Products
create table canonical_products (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references data_sources(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  row_index integer not null,
  data jsonb not null default '{}'::jsonb,
  dedup_status text not null default 'kept'
    check (dedup_status in ('kept', 'removed')),
  validation_issues jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

create index canonical_products_source_id_idx on canonical_products(source_id);
create index canonical_products_merchant_id_idx on canonical_products(merchant_id);

-- Pipeline Rules
create table pipeline_rules (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references data_sources(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  label text not null,
  plain_english text,
  stage text not null
    check (stage in ('mapping', 'dedup', 'format', 'quality', 'validation')),
  conditions jsonb default '{}'::jsonb,
  actions jsonb default '{}'::jsonb,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  last_run_at timestamptz,
  last_match_count integer default 0,
  origin text not null default 'user_created'
    check (origin in ('ai_recommended', 'user_created', 'chat'))
);

create index pipeline_rules_source_id_idx on pipeline_rules(source_id);

-- RLS Policies
alter table merchants enable row level security;
alter table data_sources enable row level security;
alter table canonical_products enable row level security;
alter table pipeline_rules enable row level security;

create policy "merchants: own row" on merchants
  for all using (auth.uid() = id);

create policy "data_sources: own rows" on data_sources
  for all using (auth.uid() = merchant_id);

create policy "canonical_products: own rows" on canonical_products
  for all using (auth.uid() = merchant_id);

create policy "pipeline_rules: own rows" on pipeline_rules
  for all using (auth.uid() = merchant_id);

-- Storage bucket for CSV uploads
insert into storage.buckets (id, name, public)
  values ('feeds', 'feeds', false)
  on conflict do nothing;

create policy "feeds: authenticated upload" on storage.objects
  for insert with check (
    bucket_id = 'feeds' and auth.role() = 'authenticated'
  );

create policy "feeds: own files" on storage.objects
  for select using (
    bucket_id = 'feeds' and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "feeds: own delete" on storage.objects
  for delete using (
    bucket_id = 'feeds' and auth.uid()::text = (storage.foldername(name))[1]
  );
