create table if not exists public.mac_commands (
  id uuid primary key,
  summary text not null,
  argv_json jsonb not null,
  cwd text null,
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  requested_by text null,
  target_host text null,
  worker_id text null,
  result_text text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null
);

create index if not exists mac_commands_status_created_idx
  on public.mac_commands (status, created_at);

create table if not exists public.mac_workers (
  worker_id text primary key,
  target_host text not null,
  status text not null default 'online',
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mac_workers_target_host_idx
  on public.mac_workers (target_host, last_seen_at desc);
