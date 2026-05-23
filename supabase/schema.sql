create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  date date not null,
  mode text not null check (mode in ('strength', 'cardio')),
  key text not null,
  name text not null,
  calories numeric not null default 0,
  minutes numeric,
  reps integer,
  volume numeric,
  sets jsonb,
  base_rate jsonb,
  effective_rate jsonb,
  body_weight numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  date date not null,
  weight_kg numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.exercise_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  exercise_type text not null check (exercise_type in ('strength', 'cardio')),
  exercise_key text not null,
  label text not null,
  kcal_per_rep numeric,
  kcal_per_minute numeric not null,
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_type, exercise_key)
);

alter table public.workouts enable row level security;
alter table public.weights enable row level security;
alter table public.exercise_rates enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.workouts to authenticated;
grant select, insert, update, delete on public.weights to authenticated;
grant select, insert, update, delete on public.exercise_rates to authenticated;

drop policy if exists "workouts select own" on public.workouts;
drop policy if exists "workouts insert own" on public.workouts;
drop policy if exists "workouts update own" on public.workouts;
drop policy if exists "workouts delete own" on public.workouts;
drop policy if exists "weights select own" on public.weights;
drop policy if exists "weights insert own" on public.weights;
drop policy if exists "weights update own" on public.weights;
drop policy if exists "weights delete own" on public.weights;
drop policy if exists "exercise_rates select own" on public.exercise_rates;
drop policy if exists "exercise_rates insert own" on public.exercise_rates;
drop policy if exists "exercise_rates update own" on public.exercise_rates;
drop policy if exists "exercise_rates delete own" on public.exercise_rates;

create policy "workouts select own"
on public.workouts for select
using (auth.uid() = user_id);

create policy "workouts insert own"
on public.workouts for insert
with check (auth.uid() = user_id);

create policy "workouts update own"
on public.workouts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "workouts delete own"
on public.workouts for delete
using (auth.uid() = user_id);

create policy "weights select own"
on public.weights for select
using (auth.uid() = user_id);

create policy "weights insert own"
on public.weights for insert
with check (auth.uid() = user_id);

create policy "weights update own"
on public.weights for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "weights delete own"
on public.weights for delete
using (auth.uid() = user_id);

create policy "exercise_rates select own"
on public.exercise_rates for select
using (auth.uid() = user_id);

create policy "exercise_rates insert own"
on public.exercise_rates for insert
with check (auth.uid() = user_id);

create policy "exercise_rates update own"
on public.exercise_rates for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "exercise_rates delete own"
on public.exercise_rates for delete
using (auth.uid() = user_id);
