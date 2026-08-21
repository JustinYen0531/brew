alter table public.brew_preferences
  add column if not exists recipe_id text not null default 'vibe-coding',
  add column if not exists editorial_tone text not null default 'hands-on-editor',
  add column if not exists brew_method text not null default 'daily-pour',
  add column if not exists source_language text not null default 'zh-Hant',
  add column if not exists selected_source_ids text[] not null default '{}',
  add column if not exists source_weights jsonb not null default '{}'::jsonb,
  add column if not exists specific_sources jsonb not null default '{}'::jsonb,
  add column if not exists direct_urls text[] not null default '{}',
  add column if not exists source_prompt text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_recipe_id_allowed') then
    alter table public.brew_preferences add constraint brew_preferences_recipe_id_allowed
      check (recipe_id in ('vibe-coding', 'ai-creative', 'ai-workflow', 'ai-product-design', 'ai-foundations'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_editorial_tone_allowed') then
    alter table public.brew_preferences add constraint brew_preferences_editorial_tone_allowed
      check (editorial_tone in ('gentle-guide', 'hands-on-editor', 'curious-editor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_brew_method_allowed') then
    alter table public.brew_preferences add constraint brew_preferences_brew_method_allowed
      check (brew_method in ('concentrated-brief', 'daily-pour', 'slow-special'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_source_language_allowed') then
    alter table public.brew_preferences add constraint brew_preferences_source_language_allowed
      check (source_language in ('zh-Hant', 'en'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_selected_source_ids_limit') then
    alter table public.brew_preferences add constraint brew_preferences_selected_source_ids_limit
      check (cardinality(selected_source_ids) <= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_direct_urls_limit') then
    alter table public.brew_preferences add constraint brew_preferences_direct_urls_limit
      check (cardinality(direct_urls) <= 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brew_preferences_source_prompt_length') then
    alter table public.brew_preferences add constraint brew_preferences_source_prompt_length
      check (char_length(source_prompt) <= 1000);
  end if;
end $$;

comment on column public.brew_preferences.recipe_id is
  'The fixed Morning Brew subject recipe selected by the user.';

comment on column public.brew_preferences.editorial_tone is
  'How the editorial voice explains the selected subject.';

comment on column public.brew_preferences.brew_method is
  'How much context and detail each Morning Brew item receives.';

comment on column public.brew_preferences.selected_source_ids is
  'Source catalog entries selected in the source cabinet; API keys never belong here.';

comment on column public.brew_preferences.direct_urls is
  'Hard source constraints; when present, web search is limited to these domains.';
