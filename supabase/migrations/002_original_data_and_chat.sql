-- Store original (pre-transform) row data for diff highlighting
alter table canonical_products
  add column if not exists original_data jsonb default '{}'::jsonb;

-- Chat sessions and messages
create table if not exists chat_sessions (
  id uuid primary key default uuid_generate_v4(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  context_type text not null check (context_type in ('source', 'sync')),
  context_id uuid not null,
  created_at timestamptz default now()
);

create table if not exists chat_messages (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- structured payload for assistant messages (preview, rule proposal, etc.)
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists chat_sessions_context_idx on chat_sessions(context_type, context_id);
create index if not exists chat_messages_session_idx on chat_messages(session_id);

-- Batch operations audit log
create table if not exists batch_operations (
  id uuid primary key default uuid_generate_v4(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  context_type text not null,
  context_id uuid not null,
  instruction text not null,
  affected_count integer,
  status text not null default 'applied' check (status in ('preview', 'applied', 'undone')),
  rule_id uuid,
  created_at timestamptz default now(),
  applied_at timestamptz
);

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table batch_operations enable row level security;

create policy "chat_sessions: own rows" on chat_sessions
  for all using (auth.uid() = merchant_id);

create policy "chat_messages: own rows via session" on chat_messages
  for all using (
    exists (
      select 1 from chat_sessions s
      where s.id = session_id and s.merchant_id = auth.uid()
    )
  );

create policy "batch_operations: own rows" on batch_operations
  for all using (auth.uid() = merchant_id);
