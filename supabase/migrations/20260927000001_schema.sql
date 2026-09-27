create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  short_name text not null,
  default_handicap numeric(4,1) not null default 0,
  photo_path text,
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.course_holes (
  course_id uuid not null references public.courses(id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  par smallint not null check (par between 3 and 6),
  stroke_index smallint not null check (stroke_index between 1 and 18),
  primary key (course_id, hole),
  unique (course_id, stroke_index)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_a_name text not null default 'Team A',
  team_a_colour text not null default '#1f4e9c',
  team_b_name text not null default 'Team B',
  team_b_colour text not null default '#c8102e',
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index events_one_active on public.events (is_active) where is_active;

create table public.event_players (
  event_id uuid not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  handicap numeric(4,1) not null,
  primary key (event_id, player_id)
);
create index event_players_player_idx on public.event_players (player_id);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  round_no smallint not null,
  date date,
  name text not null,
  allowance_pct numeric(5,2) not null default 90 check (allowance_pct between 0 and 100),
  better_ball_points numeric(4,2) not null default 1,
  singles_enabled boolean not null default false,
  singles_points numeric(4,2) not null default 0.5,
  singles_allowance_pct numeric(5,2) not null default 90 check (singles_allowance_pct between 0 and 100),
  unique (event_id, round_no)
);
create index rounds_course_idx on public.rounds (course_id);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  group_no smallint not null,
  tee_time time,
  unique (round_id, group_no)
);

create table public.group_players (
  group_id uuid not null references public.groups(id) on delete cascade,
  slot text not null check (slot in ('A1', 'A2', 'B1', 'B2')),
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (group_id, slot),
  unique (group_id, player_id)
);
create index group_players_player_idx on public.group_players (player_id);

create table public.scores (
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  gross smallint check (gross between 1 and 15),
  picked_up boolean not null default false,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (round_id, player_id, hole),
  check ((gross is null) = picked_up)
);
create index scores_player_idx on public.scores (player_id);

create table public.match_results (
  group_id uuid not null references public.groups(id) on delete cascade,
  match_type text not null check (match_type in ('better_ball', 'low_singles', 'high_singles')),
  winner text not null check (winner in ('A', 'B', 'halved')),
  points_a numeric(4,2) not null,
  points_b numeric(4,2) not null,
  result_text text not null,
  final_hole smallint not null check (final_hole between 1 and 18),
  confirmed_at timestamptz not null default now(),
  primary key (group_id, match_type)
);
