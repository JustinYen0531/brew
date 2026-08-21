create table public.brew_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  topics text[] not null default '{}',
  excluded_topics text[] not null default '{}',
  content_styles text[] not null default '{}',
  source_lanes text[] not null default '{}',
  difficulty_levels text[] not null default array['普通']::text[],
  reading_minutes smallint not null default 10,
  item_count smallint not null default 10,
  novelty_level smallint not null default 3,
  review_enabled boolean not null default true,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint brew_preferences_topics_limit
    check (cardinality(topics) <= 12),
  constraint brew_preferences_excluded_topics_limit
    check (cardinality(excluded_topics) <= 12),
  constraint brew_preferences_content_styles_limit
    check (cardinality(content_styles) <= 8),
  constraint brew_preferences_source_lanes_limit
    check (cardinality(source_lanes) <= 8),
  constraint brew_preferences_difficulty_limit
    check (
      cardinality(difficulty_levels) between 1 and 3
      and difficulty_levels <@ array['初學者', '普通', '困難']::text[]
    ),
  constraint brew_preferences_reading_minutes_allowed
    check (reading_minutes in (5, 10, 20)),
  constraint brew_preferences_item_count_allowed
    check (item_count in (5, 10, 15)),
  constraint brew_preferences_novelty_level_range
    check (novelty_level between 1 and 5)
);

comment on table public.brew_preferences is
  'Per-user Morning Brew recipe used for personalized curation and onboarding.';

comment on column public.brew_preferences.user_id is
  'Owner from auth.users; never accepted from an unverified client payload.';

alter table public.brew_preferences enable row level security;

revoke all on table public.brew_preferences from anon;
grant select, insert, update on table public.brew_preferences to authenticated;

create policy "Users can read their own Morning Brew recipe"
  on public.brew_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own Morning Brew recipe"
  on public.brew_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own Morning Brew recipe"
  on public.brew_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
