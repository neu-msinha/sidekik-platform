-- docs/SCHEMA.md 0005_mapping.sql — owner: mapper (Mayukh)

create table work_maps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  workflow_id uuid not null references workflows(id),
  expert_id uuid not null references experts(id),
  session_id uuid references sessions(id),
  version int not null,
  status text not null check (status in ('draft','in_debrief','confirmed','published','retired')),
  language text not null,
  json jsonb not null,              -- full WorkMap (ARCHITECTURE Appendix B)
  confirmed_turn_id text,
  published_at timestamptz,
  unique (workflow_id, version)
);

create table work_map_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  work_map_id uuid not null references work_maps(id) on delete cascade,
  key text not null,                -- 'S4'
  ordinal int not null,
  title text not null,
  decision text not null,
  reason_quote text, reason_quote_en text, reason_turn_id text, source_label text,
  is_judgment_call boolean not null default false,
  screen_moment jsonb not null,
  screen_signature jsonb not null,
  el_procedure_id text,
  unique (work_map_id, key)
);

create table guardrails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  work_map_id uuid not null references work_maps(id) on delete cascade,
  key text not null,                -- 'G1'
  kind text not null check (kind in ('threshold','condition','stop_and_ask','second_approval','hold')),
  description text not null,
  rule_jsonlogic jsonb not null,
  consequence jsonb not null,
  quote text not null, quote_en text,
  unique (work_map_id, key)
);

create table step_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  work_map_id uuid not null references work_maps(id) on delete cascade,
  step_id uuid references work_map_steps(id) on delete cascade,
  guardrail_id uuid references guardrails(id) on delete cascade,
  screen_event_id text,
  keyframe_id uuid references keyframes(id) on delete set null,
  clip_id uuid references clips(id) on delete set null,
  transcript_turn_id text not null,
  t_ms int not null,
  quote text,
  source_label text,
  check (step_id is not null or guardrail_id is not null)
);

create table open_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  workflow_id uuid not null references workflows(id),
  work_map_id uuid references work_maps(id) on delete cascade,
  session_id uuid references sessions(id),
  text text not null,
  anchor_t_ms int,
  origin text not null check (origin in ('live','builder','learner_gap')),
  status text not null check (status in ('open','asked','resolved')),
  importance int not null default 2  -- 1 low .. 3 high
);

create table kb_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  workflow_id uuid not null references workflows(id),
  work_map_id uuid references work_maps(id) on delete cascade,
  kind text not null check (kind in ('step','guardrail','answer')),
  ref_id uuid,
  content text not null,             -- original language + English, concatenated
  tsv tsvector generated always as (to_tsvector('simple', content)) stored
);
-- 'simple' config: no language stemming, so German and English text index the same way
create index on kb_chunks using gin (tsv);
create index on kb_chunks using gin (content gin_trgm_ops);   -- fuzzy fallback (typos, partial words)

-- recall_context query (mapper): full-text first, trigram word similarity as fallback.
-- Word similarity (<%), not whole-string similarity (%): a short query against a long chunk never reaches
-- the whole-string threshold, so typos would never match. 0.4 finds typo'd words ("Anlagenumer", "Kranbua").
create or replace function search_kb(p_org uuid, p_workflow uuid, p_query text, p_limit int default 5)
returns table (id uuid, kind text, ref_id uuid, content text, score real)
language sql stable
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with fts as (
    select k.id, k.kind, k.ref_id, k.content,
           ts_rank(k.tsv, websearch_to_tsquery('simple', p_query)) as score
    from kb_chunks k
    where k.org_id = p_org and k.workflow_id = p_workflow
      and k.tsv @@ websearch_to_tsquery('simple', p_query)
  ), trgm as (
    select k.id, k.kind, k.ref_id, k.content, word_similarity(p_query, k.content) as score
    from kb_chunks k
    where k.org_id = p_org and k.workflow_id = p_workflow
      and not exists (select 1 from fts)
      and p_query <% k.content
  )
  select * from fts union all select * from trgm
  order by score desc limit p_limit;
$$;

create table expert_memory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  expert_id uuid not null references experts(id),
  workflow_id uuid not null references workflows(id),
  summary text not null default '',
  open_item_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (expert_id, workflow_id)
);

alter table workflows     add foreign key (current_workmap_id) references work_maps(id);
alter table sessions      add foreign key (workmap_id) references work_maps(id);
alter table agent_configs add foreign key (workmap_id) references work_maps(id);
alter table clips         add foreign key (step_id) references work_map_steps(id) on delete set null;
