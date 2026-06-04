-- Track whether the user has reviewed platform recommendations for a sync
alter table platform_syncs add column if not exists recommendations_seen boolean not null default false;
