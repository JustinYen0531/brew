create table public.brew_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint brew_profiles_nickname_length
    check (char_length(btrim(nickname)) between 1 and 32),
  constraint brew_profiles_nickname_no_control_chars
    check (nickname !~ '[[:cntrl:]]')
);

comment on table public.brew_profiles is
  'A friendly display name for a Morning Brew account. The Supabase auth user_id remains the real owner identity.';

comment on column public.brew_profiles.user_id is
  'The unique anonymous-or-authenticated Supabase identity; never accepted from an unverified client payload.';

comment on column public.brew_profiles.nickname is
  'A non-secret name printed in the Morning Brew UI, not a password and not a login credential.';

alter table public.brew_profiles enable row level security;

revoke all on table public.brew_profiles from anon;
grant select, insert, update on table public.brew_profiles to authenticated;

create policy "Users can read their own Morning Brew profile"
  on public.brew_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own Morning Brew profile"
  on public.brew_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own Morning Brew profile"
  on public.brew_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
