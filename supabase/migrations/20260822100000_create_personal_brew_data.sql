create table if not exists public.brew_editions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  edition_date date not null,
  as_of_date date not null,
  kind text not null default 'daily',
  pot_number integer not null default 1,
  status text not null default 'complete',
  provider text not null default 'openrouter',
  model text not null default '',
  requested_count smallint not null,
  title text not null default 'Vibe Coding 每日手沖',
  objective text not null default '',
  generation_recipe jsonb not null default '{}'::jsonb,
  generation_run_id text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brew_editions_kind_allowed check (kind in ('daily', 'manual', 'historical')),
  constraint brew_editions_status_allowed check (status in ('pending', 'complete', 'failed')),
  constraint brew_editions_pot_number_positive check (pot_number >= 1),
  constraint brew_editions_requested_count_allowed check (requested_count between 1 and 15),
  unique (user_id, edition_date, kind, pot_number)
);

create table if not exists public.brew_edition_items (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.brew_editions (id) on delete cascade,
  position smallint not null,
  lesson_key text not null,
  payload jsonb not null,
  source_url text not null default '',
  source_platform text not null default '',
  category text not null default '',
  difficulty text not null default '普通',
  published_at date,
  created_at timestamptz not null default now(),
  constraint brew_edition_items_position_positive check (position between 1 and 15),
  constraint brew_edition_items_difficulty_allowed check (difficulty in ('初學者', '普通', '困難')),
  unique (edition_id, position),
  unique (edition_id, lesson_key)
);

create table if not exists public.brew_item_marks (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_key text not null,
  favorite_state smallint not null default 0,
  read_at timestamptz,
  review_enabled boolean not null default true,
  last_edition_id uuid references public.brew_editions (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_key),
  constraint brew_item_marks_favorite_state_allowed check (favorite_state between 0 and 2)
);

create table if not exists public.brew_feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_key text not null,
  edition_id uuid references public.brew_editions (id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint brew_feedback_events_action_allowed check (
    action in ('starred', 'super_starred', 'unstarred', 'unsuper_starred', 'read', 'unread', 'not_interested', 'want_more', 'exclude_source', 'want_to_build', 'reviewed', 'skipped')
  )
);

create table if not exists public.brew_review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_key text not null,
  edition_id uuid references public.brew_editions (id) on delete set null,
  due_on date not null,
  interval_days integer not null default 0,
  repetition smallint not null default 0,
  status text not null default 'pending',
  prompt text not null default '還記得這個原則解決什麼問題嗎？',
  source_snapshot jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brew_review_queue_status_allowed check (status in ('pending', 'completed', 'skipped')),
  constraint brew_review_queue_interval_nonnegative check (interval_days >= 0),
  constraint brew_review_queue_repetition_nonnegative check (repetition >= 0)
);

create index if not exists brew_editions_user_date_idx
  on public.brew_editions (user_id, edition_date desc, kind, pot_number desc);
create index if not exists brew_edition_items_edition_position_idx
  on public.brew_edition_items (edition_id, position);
create index if not exists brew_feedback_events_user_created_idx
  on public.brew_feedback_events (user_id, created_at desc);
create index if not exists brew_review_queue_user_due_idx
  on public.brew_review_queue (user_id, status, due_on);

comment on table public.brew_editions is
  'A personal Morning Brew edition; one user, one dated daily edition, plus explicit manual pots.';
comment on column public.brew_editions.generation_recipe is
  'Immutable recipe snapshot used to make this edition; must never contain API keys.';
comment on table public.brew_edition_items is
  'The lessons actually shown in a personal edition, preserving the source evidence payload.';
comment on table public.brew_item_marks is
  'Current per-user reading and Starred/Super Starred state for a lesson.';
comment on table public.brew_feedback_events is
  'Append-only user feedback signals used to personalize later pots.';
comment on table public.brew_review_queue is
  'Second Pour items scheduled for a future date.';

alter table public.brew_editions enable row level security;
alter table public.brew_edition_items enable row level security;
alter table public.brew_item_marks enable row level security;
alter table public.brew_feedback_events enable row level security;
alter table public.brew_review_queue enable row level security;

revoke all on table public.brew_editions from anon;
revoke all on table public.brew_edition_items from anon;
revoke all on table public.brew_item_marks from anon;
revoke all on table public.brew_feedback_events from anon;
revoke all on table public.brew_review_queue from anon;

grant select, insert, update, delete on table public.brew_editions to authenticated;
grant select, insert, update, delete on table public.brew_edition_items to authenticated;
grant select, insert, update, delete on table public.brew_item_marks to authenticated;
grant select, insert on table public.brew_feedback_events to authenticated;
grant select, insert, update on table public.brew_review_queue to authenticated;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'Users can read their own Morning Brew editions' and polrelid = 'public.brew_editions'::regclass) then
    create policy "Users can read their own Morning Brew editions"
      on public.brew_editions for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can create their own Morning Brew editions' and polrelid = 'public.brew_editions'::regclass) then
    create policy "Users can create their own Morning Brew editions"
      on public.brew_editions for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can update their own Morning Brew editions' and polrelid = 'public.brew_editions'::regclass) then
    create policy "Users can update their own Morning Brew editions"
      on public.brew_editions for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can delete their own Morning Brew editions' and polrelid = 'public.brew_editions'::regclass) then
    create policy "Users can delete their own Morning Brew editions"
      on public.brew_editions for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policy where polname = 'Users can read their own Morning Brew edition items' and polrelid = 'public.brew_edition_items'::regclass) then
    create policy "Users can read their own Morning Brew edition items"
      on public.brew_edition_items for select to authenticated
      using (exists (select 1 from public.brew_editions e where e.id = edition_id and e.user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can create their own Morning Brew edition items' and polrelid = 'public.brew_edition_items'::regclass) then
    create policy "Users can create their own Morning Brew edition items"
      on public.brew_edition_items for insert to authenticated
      with check (exists (select 1 from public.brew_editions e where e.id = edition_id and e.user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can update their own Morning Brew edition items' and polrelid = 'public.brew_edition_items'::regclass) then
    create policy "Users can update their own Morning Brew edition items"
      on public.brew_edition_items for update to authenticated
      using (exists (select 1 from public.brew_editions e where e.id = edition_id and e.user_id = (select auth.uid())))
      with check (exists (select 1 from public.brew_editions e where e.id = edition_id and e.user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can delete their own Morning Brew edition items' and polrelid = 'public.brew_edition_items'::regclass) then
    create policy "Users can delete their own Morning Brew edition items"
      on public.brew_edition_items for delete to authenticated
      using (exists (select 1 from public.brew_editions e where e.id = edition_id and e.user_id = (select auth.uid())));
  end if;

  if not exists (select 1 from pg_policy where polname = 'Users can read their own Morning Brew marks' and polrelid = 'public.brew_item_marks'::regclass) then
    create policy "Users can read their own Morning Brew marks"
      on public.brew_item_marks for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can create their own Morning Brew marks' and polrelid = 'public.brew_item_marks'::regclass) then
    create policy "Users can create their own Morning Brew marks"
      on public.brew_item_marks for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can update their own Morning Brew marks' and polrelid = 'public.brew_item_marks'::regclass) then
    create policy "Users can update their own Morning Brew marks"
      on public.brew_item_marks for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policy where polname = 'Users can read their own Morning Brew feedback' and polrelid = 'public.brew_feedback_events'::regclass) then
    create policy "Users can read their own Morning Brew feedback"
      on public.brew_feedback_events for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can create their own Morning Brew feedback' and polrelid = 'public.brew_feedback_events'::regclass) then
    create policy "Users can create their own Morning Brew feedback"
      on public.brew_feedback_events for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policy where polname = 'Users can read their own Morning Brew review queue' and polrelid = 'public.brew_review_queue'::regclass) then
    create policy "Users can read their own Morning Brew review queue"
      on public.brew_review_queue for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can create their own Morning Brew review queue' and polrelid = 'public.brew_review_queue'::regclass) then
    create policy "Users can create their own Morning Brew review queue"
      on public.brew_review_queue for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policy where polname = 'Users can update their own Morning Brew review queue' and polrelid = 'public.brew_review_queue'::regclass) then
    create policy "Users can update their own Morning Brew review queue"
      on public.brew_review_queue for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;
