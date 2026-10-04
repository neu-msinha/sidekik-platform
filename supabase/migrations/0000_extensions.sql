-- docs/SCHEMA.md "0000 extensions"
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;    -- fuzzy matching for recall_context
