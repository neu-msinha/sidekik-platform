-- docs/SCHEMA.md 0008_storage.sql
insert into storage.buckets (id, name, public) values
  ('captures','captures',false), ('workmaps','workmaps',false), ('replays','replays',false)
on conflict do nothing;
-- No storage policies for anon/authenticated: all access via signed URLs minted by services.
