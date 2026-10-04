-- docs/SCHEMA.md 0004_capture.sql — owner: perception + brain (Sahil)

-- perception
create table keyframes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  t_ms int not null,
  storage_path text not null,
  phash text not null,              -- 16 hex chars (64-bit)
  redacted boolean not null default true
);
create index on keyframes (session_id, t_ms);

create table screen_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  event_id text not null unique,    -- ulid from the envelope
  t_ms int not null,
  type text not null,
  entity_kind text, entity_id text, field text,
  before_val text, after_val text,
  state jsonb,
  bbox jsonb,
  confidence real,
  source text not null check (source in ('vision','dom')),
  keyframe_id uuid references keyframes(id) on delete set null,
  event_class text                  -- D2 result, written by brain via update
);
create index on screen_events (session_id, t_ms);

create table clips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  step_id uuid,                     -- FK added in 0005
  t_ms int not null,
  storage_path text not null,
  duration_s real not null
);

-- brain
create table questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  phase text not null check (phase in ('capture','debrief')),
  qtype text not null check (qtype in ('exception','limit','other','stop_and_ask','why')),
  text text not null,
  anchor_event_ids text[] not null default '{}',
  status text not null check (status in ('candidate','asked','answered','expired')),
  created_t_ms int not null,
  asked_t_ms int,
  jev_scores jsonb
);
create index on questions (session_id, status);

create table answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  turn_ids text[] not null,
  content_class text not null,
  quote text not null,
  quote_en text,
  has_condition boolean not null default false,
  extracted_rule text
);

create table decisions_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid references sessions(id) on delete cascade,
  decision text not null,           -- 'D1'..'D12'
  provider text not null check (provider in ('jev','openrouter-jev','llm')),
  model text,
  answer jsonb not null,
  confidence real,
  escalated boolean not null default false,
  latency_ms int not null,
  input_tokens int,
  cost_usd numeric(12,6),
  counterfactual_usd numeric(12,6)
);
create index on decisions_log (session_id, created_at);

-- Note: brain updates screen_events.event_class (a column perception doesn't write).
-- This is the one shared-write exception, and it's allowed (SCHEMA.md).
