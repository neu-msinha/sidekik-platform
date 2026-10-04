-- 0003_meetbot.sql — owner: meetbot (Aadil)
-- Implements docs/SCHEMA.md §0003 exactly. Depends on 0001_core.sql (orgs, sessions).
-- RLS policies for this table are added in 0007_rls.sql.

create table meeting_bots (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_id uuid not null references sessions(id) on delete cascade,
  bot_id     text not null unique,
  platform   text check (platform in ('google_meet','zoom','teams','unknown')),
  status     text not null,
  joined_at  timestamptz,
  left_at    timestamptz,
  error      text
);
