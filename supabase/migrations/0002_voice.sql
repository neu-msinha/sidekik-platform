-- 0002_voice.sql — owner: voice (Aadil)
-- Implements docs/SCHEMA.md §0002 exactly. Depends on 0001_core.sql (orgs, sessions).
-- RLS policies for these tables are added in 0007_rls.sql.

create table transcript_turns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  created_at    timestamptz not null default now(),
  session_id    uuid not null references sessions(id) on delete cascade,
  turn_id       text not null,
  role          text not null check (role in ('user','agent')),
  text_redacted text not null,
  lang          text,
  t_ms          int not null,
  source        text not null check (source in ('live','webhook')),
  off_record    boolean not null default false,
  unique (session_id, turn_id)
);
create index on transcript_turns (session_id, t_ms);

create table agent_configs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  created_at    timestamptz not null default now(),
  workmap_id    uuid,                              -- FK added in 0005
  version       int not null,
  el_agent_id   text not null,
  kb_doc_id     text,
  procedure_ids jsonb not null default '{}'        -- {step_id: procedure_id, "intervention": id}
);
