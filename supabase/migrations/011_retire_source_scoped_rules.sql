-- Retire source-scoped and global pipeline_rules.
--
-- Per DESIGN_BRIEF_feed_assistant.md §2, sources are raw read-only uploads and
-- all transformation lives at the sync level. Rules with sync_id NULL (the old
-- source-scoped tier and the old global tier) are executed by nothing — the
-- sync runner only loads rules where sync_id matches.
--
-- Per the brief's migration note: migrate where a source maps to exactly one
-- sync; otherwise leave for the merchant. We disable (not delete) the
-- remainder so nothing is silently lost and they stay recoverable.

-- 1. Migrate: source-scoped rules whose source feeds exactly one sync move to
--    that sync.
with single_sync_sources as (
  select
    ds.id as source_id,
    (array_agg(ps.id))[1] as sync_id
  from data_sources ds
  join platform_syncs ps
    on ds.id = any(ps.source_ids)
   and ps.merchant_id = ds.merchant_id
  group by ds.id
  having count(distinct ps.id) = 1
)
update pipeline_rules pr
set sync_id = sss.sync_id,
    source_id = null
from single_sync_sources sss
where pr.sync_id is null
  and pr.source_id = sss.source_id;

-- 2. Disable any remaining orphaned rules: global rules (no source, no sync)
--    and source rules whose source feeds zero or multiple syncs. They were
--    never executed, so disabling changes no behavior — it just makes the
--    stored state honest.
update pipeline_rules
set enabled = false
where sync_id is null;
