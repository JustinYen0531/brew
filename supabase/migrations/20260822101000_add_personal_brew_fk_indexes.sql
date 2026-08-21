create index if not exists brew_feedback_events_edition_idx
  on public.brew_feedback_events (edition_id);

create index if not exists brew_item_marks_last_edition_idx
  on public.brew_item_marks (last_edition_id);

create index if not exists brew_review_queue_edition_idx
  on public.brew_review_queue (edition_id);
