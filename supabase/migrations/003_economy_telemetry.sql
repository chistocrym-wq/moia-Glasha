-- Economy-first request telemetry.
-- No raw user text, documents, tokens or personal payloads are stored.

create table if not exists public.request_telemetry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_type text not null check (route_type in ('LOCAL','SUPABASE_ONLY','AI_FAST','AI_DEEP','WEB_SEARCH')),
  intent text not null,
  latency_ms integer not null check (latency_ms >= 0),
  openai_calls_count integer not null default 0 check (openai_calls_count >= 0),
  web_search_used boolean not null default false,
  model_used text,
  supabase_queries_count integer not null default 0 check (supabase_queries_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists request_telemetry_user_created_idx
  on public.request_telemetry(user_id, created_at desc);

alter table public.request_telemetry enable row level security;

drop policy if exists "owner_select" on public.request_telemetry;
drop policy if exists "owner_insert" on public.request_telemetry;
drop policy if exists "owner_delete" on public.request_telemetry;

create policy "owner_select"
on public.request_telemetry
for select to authenticated
using (auth.uid() = user_id);

create policy "owner_insert"
on public.request_telemetry
for insert to authenticated
with check (auth.uid() = user_id);

create policy "owner_delete"
on public.request_telemetry
for delete to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on public.request_telemetry to authenticated;
revoke all on public.request_telemetry from anon;
