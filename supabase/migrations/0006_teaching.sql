-- docs/SCHEMA.md 0006_teaching.sql — owner: tutor (Mayukh)

create table learner_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  learner_id uuid not null references learners(id),
  work_map_id uuid not null references work_maps(id),
  step_id uuid not null references work_map_steps(id),
  case_ref text,
  predicted text,
  prediction_grade text,
  actual_action jsonb,
  outcome text check (outcome in ('independent_correct','prompted_correct',
                                   'corrected_after_intervention','not_attempted'))
);

create table interventions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  learner_id uuid not null references learners(id),
  guardrail_id uuid references guardrails(id),
  step_id uuid references work_map_steps(id),
  t_ms int not null,
  trigger text not null check (trigger in ('presave','live','divergence')),
  style text not null check (style in ('hint_soft','intervene_now')),
  resolved boolean not null default false
);

create table mastery (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  learner_id uuid not null references learners(id),
  work_map_id uuid not null references work_maps(id),
  summary jsonb not null            -- MasterySummary
);

create table gap_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  work_map_id uuid not null references work_maps(id) on delete cascade,
  step_id uuid references work_map_steps(id),
  guardrail_id uuid references guardrails(id),
  kind text not null check (kind in ('guardrail_tripped','prediction_unsure')),
  learner_ids uuid[] not null default '{}',
  status text not null default 'open' check (status in ('open','sent_to_expert','resolved')),
  unique (work_map_id, step_id, guardrail_id, kind)
);
