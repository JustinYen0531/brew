grant delete on table public.brew_review_queue to authenticated;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'Users can delete their own Morning Brew review queue' and polrelid = 'public.brew_review_queue'::regclass) then
    create policy "Users can delete their own Morning Brew review queue"
      on public.brew_review_queue for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;
