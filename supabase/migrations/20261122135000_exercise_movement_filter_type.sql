-- Type of movement from source sheet column J.
-- Keep historical movement_type='Силовое' unchanged.
alter table public.exercises add column if not exists movement_filter_type text;
