-- Allow pipeline_rules to exist at merchant scope (no source) for global rules
alter table pipeline_rules alter column source_id drop not null;

-- Index for fast global rule lookup per merchant
create index if not exists pipeline_rules_global_idx on pipeline_rules(merchant_id) where source_id is null;
