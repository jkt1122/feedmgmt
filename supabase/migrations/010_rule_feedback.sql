alter table rule_memories
  add column if not exists feedback_text text,
  add column if not exists source_fingerprint text,
  add column if not exists replacement_fingerprint text,
  add column if not exists preference_key text,
  add column if not exists replacement_rule_spec jsonb;

create index if not exists rule_memories_sync_preference_idx
  on rule_memories(merchant_id, sync_id, preference_key)
  where preference_key is not null;
