-- docs/SCHEMA.md 0001_core.sql — owner: gateway (Mayukh)
-- Every table except orgs carries the base columns: id, org_id, created_at.

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{"retention_days":30,"store_learner_keyframes":false,
     "languages":["de","en"],"jev_enabled":true,"consent_text_version":"v1"}',
  created_at timestamptz not null default now()
);

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','expert','learner','manager')),
  unique (org_id, user_id)
);

create table experts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  display_name text not null,
  language text not null default 'de',
  onet_code text
);

create table learners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  display_name text not null,
  language text not null default 'en'
);

create table workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  name text not null,
  description text,
  onet_code text,
  current_workmap_id uuid           -- FK added in 0005
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  workflow_id uuid not null references workflows(id),
  kind text not null check (kind in ('capture','tutor')),
  mode text not null check (mode in ('browser','meeting','replay')),
  phase text not null check (phase in ('capture','building','debrief','confirmed','tutoring','done')),
  expert_id uuid references experts(id),
  learner_id uuid references learners(id),
  workmap_id uuid,                  -- FK added in 0005 (tutor sessions)
  language text not null default 'en',
  el_agent_id text,
  el_conversation_id text,
  off_record boolean not null default false,
  consent_at timestamptz,
  replay_of uuid references sessions(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid references auth.users(id),
  text_version text not null,
  scopes text[] not null,           -- {'audio','screen','storage'}
  granted_at timestamptz not null default now()
);

create table off_record_spans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  start_t_ms int not null,
  end_t_ms int,
  source text not null check (source in ('ui','agent','chat','brain','retroactive'))
);

create table agent_host_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  token text not null unique,
  session_id uuid not null references sessions(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table cost_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid references sessions(id) on delete cascade,
  service text not null,
  vendor text not null check (vendor in ('elevenlabs','typesafe','anthropic','recall')),
  units numeric not null,
  unit text not null,
  cost_usd numeric(12,6) not null,
  counterfactual_usd numeric(12,6)
);

create table replay_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  stream text not null,
  t_ms int not null,
  envelope jsonb not null
);
create index on replay_events (session_id, t_ms);
