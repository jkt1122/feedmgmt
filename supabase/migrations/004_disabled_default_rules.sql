alter table data_sources add column if not exists disabled_default_rules text[] default '{}';
