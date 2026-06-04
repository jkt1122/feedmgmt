-- Expand origin check constraint to include platform_spec
alter table pipeline_rules
  drop constraint if exists pipeline_rules_origin_check;

alter table pipeline_rules
  add constraint pipeline_rules_origin_check
  check (origin in ('ai_recommended', 'user_created', 'chat', 'platform_spec'));
