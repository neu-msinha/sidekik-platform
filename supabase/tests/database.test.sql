-- pgTAP: `supabase test db` (runs against the reset + seeded local database, rolled back after).
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ---------------------------------------------------------------- schema
select is(
  (select count(*)::int from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'),
  31, '31 tables (orgs + 30 with the base columns)');
select is(
  (select count(*)::int from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'org_id'),
  30, 'every table except orgs has org_id');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every table');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT'),
  0, 'no write policies: only services (service role) write');
select has_index('public', 'screen_events', 'screen_events_session_id_t_ms_idx', 'screen_events (session_id, t_ms)');
select has_index('public', 'transcript_turns', 'transcript_turns_session_id_t_ms_idx', 'transcript_turns (session_id, t_ms)');
select has_index('public', 'kb_chunks', 'kb_chunks_tsv_idx', 'kb_chunks full-text index');
select col_is_unique('public', 'screen_events', 'event_id', 'screen_events.event_id is unique (idempotent inserts)');
select fk_ok('public', 'workflows', 'current_workmap_id', 'public', 'work_maps', 'id');

-- ---------------------------------------------------------------- seed
select is((select name from orgs where id = '00000000-0000-4000-8000-000000000001'), 'Maschinenbau AG', 'demo org');
select is((select count(*)::int from work_map_steps), 7, 'S1–S7');
select is((select count(*)::int from guardrails), 5, 'G1–G5');
select is(
  (select current_workmap_id from workflows where name = 'Supplier invoice coding'),
  '00000000-0000-4000-8000-000000000041'::uuid, 'workflow points at the published Work Map');
select is(
  (select count(*)::int from work_map_steps s where not exists (select 1 from step_evidence e where e.step_id = s.id))
  + (select count(*)::int from guardrails g where not exists (select 1 from step_evidence e where e.guardrail_id = g.id)),
  0, 'every step and guardrail has evidence');
select is((select json->>'status' from work_maps), 'published', 'work_maps.json is the full WorkMap');

-- ---------------------------------------------------------------- search_kb
select is(
  (select content like 'G1 %' from search_kb('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000031', 'fünftausend Anlagevermögen') limit 1),
  true, 'search_kb: full-text finds G1 from the German quote');
select is(
  (select left(content, 2) from search_kb('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000031', 'Anlagenumer 0400') limit 1),
  'S5', 'search_kb: trigram fallback finds S5 despite the typo');

-- ---------------------------------------------------------------- storage
select is(
  (select count(*)::int from search_kb('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000031', 'Druckerpapier Weber')),
  0, 'search_kb: unrelated queries return nothing');
select is((select count(*)::int from storage.buckets where id in ('captures','workmaps','replays') and not public), 3, 'three private buckets');

-- ---------------------------------------------------------------- RLS as real users
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000a0001', 'admin@test.local'),
  ('00000000-0000-4000-8000-0000000a0002', 'lena@test.local'),
  ('00000000-0000-4000-8000-0000000a0003', 'other-learner@test.local'),
  ('00000000-0000-4000-8000-0000000a0004', 'outsider@test.local');
select public.grant_demo_role('admin@test.local');
select public.grant_demo_role('lena@test.local', 'learner');
select public.grant_demo_role('other-learner@test.local', 'learner');
update learners set user_id = '00000000-0000-4000-8000-0000000a0002' where display_name = 'Lena';
insert into learners (id, org_id, user_id, display_name) values
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000a0003', 'Other');
insert into sessions (id, org_id, workflow_id, kind, mode, phase, learner_id) values
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000031', 'tutor', 'browser', 'tutoring', '00000000-0000-4000-8000-000000000021');
insert into learner_attempts (org_id, session_id, learner_id, work_map_id, step_id, outcome) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000104', 'corrected_after_intervention'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000104', 'independent_correct');
insert into agent_host_tokens (org_id, token, session_id, expires_at) values
  ('00000000-0000-4000-8000-000000000001', 'one-time-secret', '00000000-0000-4000-8000-0000000b0001', now() + interval '1 hour');

-- anon: nothing
set local role anon;
select is((select count(*)::int from orgs), 0, 'anon sees no orgs');
select is((select count(*)::int from work_map_steps), 0, 'anon sees no steps');
reset role;

-- outsider (signed in, not a member): nothing
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000a0004","role":"authenticated"}';
select is((select count(*)::int from orgs), 0, 'non-member sees no orgs');
select is((select count(*)::int from guardrails), 0, 'non-member sees no guardrails');
reset role;

-- admin: the whole org, all attempts, but never agent-host tokens
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000a0001","role":"authenticated"}';
select is((select count(*)::int from orgs), 1, 'admin sees the org');
select is((select count(*)::int from work_map_steps), 7, 'admin sees the Work Map steps');
select is((select count(*)::int from learner_attempts), 2, 'admin sees every learner attempt');
select is((select count(*)::int from agent_host_tokens), 0, 'agent-host tokens are never readable from the browser');
select throws_ok(
  $$insert into questions (org_id, session_id, phase, qtype, text, status, created_t_ms)
    values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000b0001', 'capture', 'why', 'x', 'candidate', 0)$$,
  '42501', null, 'the browser cannot write');
reset role;

-- learner: own attempts only
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000a0002","role":"authenticated"}';
select is((select count(*)::int from learner_attempts), 1, 'Lena sees only her own attempt');
select is((select outcome from learner_attempts), 'corrected_after_intervention', '… and it is hers');
select is((select count(*)::int from guardrails), 5, 'learners can read the Work Map');
reset role;

-- the admin grant helper is not callable from the browser
set local role authenticated;
select throws_ok($$select public.grant_demo_role('outsider@test.local')$$, '42501', null, 'grant_demo_role is service-only');
reset role;

select * from finish();
rollback;
