-- docs/SCHEMA.md 0007_rls.sql — owner: platform (Sahil), reviewed by Mayukh
--
-- The browser only reads (Supabase Auth JWT); every write comes from a service using the service role,
-- which bypasses RLS. So: RLS on every table, select policies only, no insert/update/delete policies.

-- SECURITY DEFINER so policies can read org_members without recursing into its own RLS.
-- search_path is pinned and names are schema-qualified (definer functions must not resolve user objects).
create or replace function public.is_member(org uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.org_members m where m.org_id = org and m.user_id = auth.uid());
$$;

create or replace function public.has_role(org uuid, roles text[]) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.org_members m where m.org_id = org and m.user_id = auth.uid()
                 and m.role = any(roles));
$$;

-- orgs: members see their own org.
alter table orgs enable row level security;
create policy org_read on orgs for select using (public.is_member(id));

-- Every other table with org_id: members of the org can read its rows.
-- Exceptions:
--   learner_attempts, mastery: learner privacy (learner_own below instead of org_read).
--   agent_host_tokens: one-time credentials for the meeting bot's page. Only the gateway (service role)
--     reads them; an org_read policy would let any member claim an agent-host session. RLS on, no policy.
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id' and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('alter table public.%I enable row level security', t);
    if t not in ('learner_attempts', 'mastery', 'agent_host_tokens') then
      execute format('create policy org_read on public.%I for select using (public.is_member(org_id))', t);
    end if;
  end loop;
end $$;

-- Learner privacy: a learner sees only their own attempts and mastery; admins and managers see all.
create policy learner_own on learner_attempts for select using (
  public.has_role(org_id, array['admin','manager'])
  or learner_id in (select id from public.learners where user_id = auth.uid()));
create policy learner_own on mastery for select using (
  public.has_role(org_id, array['admin','manager'])
  or learner_id in (select id from public.learners where user_id = auth.uid()));

-- Guard: fail the migration if any public table was left without RLS.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS not enabled on: %', missing;
  end if;
end $$;
