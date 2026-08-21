alter table public.brew_preferences
  add column if not exists topic_weights jsonb not null default '{}'::jsonb,
  add column if not exists output_language text not null default 'zh-Hant',
  add column if not exists blend_ratios jsonb not null default '{"new_discoveries":60,"saved_reviews":20,"classic":10,"surprise":10}'::jsonb,
  add column if not exists timezone text not null default 'Asia/Taipei',
  add column if not exists morning_time time not null default '07:00';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_output_language_allowed') then
    alter table public.brew_preferences add constraint brew_preferences_output_language_allowed
      check (output_language in ('zh-Hant', 'en'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_topic_weights_object') then
    alter table public.brew_preferences add constraint brew_preferences_topic_weights_object
      check (jsonb_typeof(topic_weights) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_blend_ratios_object') then
    alter table public.brew_preferences add constraint brew_preferences_blend_ratios_object
      check (jsonb_typeof(blend_ratios) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_timezone_shape') then
    alter table public.brew_preferences add constraint brew_preferences_timezone_shape
      check (timezone ~ '^[A-Za-z0-9_+.-]+(/[A-Za-z0-9_+.-]+){0,2}$' and char_length(timezone) between 1 and 64);
  end if;
end $$;

comment on column public.brew_preferences.topic_weights is
  'Soft topic preference, 1 to 5 per topic; used for personalized candidate ranking.';

comment on column public.brew_preferences.output_language is
  'Language used for the generated Morning Brew learning copy.';

comment on column public.brew_preferences.blend_ratios is
  'Percentage recipe for new discoveries, saved reviews, classics, and surprises.';

comment on column public.brew_preferences.timezone is
  'IANA timezone used when a daily delivery schedule is added.';

comment on column public.brew_preferences.morning_time is
  'Preferred local time for a future automatic Morning Brew delivery.';
