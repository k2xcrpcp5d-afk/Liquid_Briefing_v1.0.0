-- Liquid Briefing v0.5 - listener profiles (one row per Supabase Auth user)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  identity text check (identity in ('student', 'professional', 'investor', 'founder', 'curious')),
  topics text[] not null default '{}',
  companies text[] not null default '{}',
  expertise text check (expertise in ('beginner', 'intermediate', 'expert')),
  tone text not null default 'neutral' check (tone in ('calm', 'neutral', 'energetic')),
  region text not null default 'global' check (region in ('europe', 'us', 'asia', 'global')),
  default_length text not null default 'short' check (default_length in ('short', 'medium', 'long')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile: read" on public.profiles;
drop policy if exists "own profile: insert" on public.profiles;
drop policy if exists "own profile: update" on public.profiles;
create policy "own profile: read"   on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile: insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "own profile: update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant select, insert, update on public.profiles to authenticated;

-- v1.0 Deweys Crew: the host character chosen in onboarding (default for every briefing)
alter table public.profiles add column if not exists character text check (character in ('pip','tide','flo','brook','rain'));

-- v1.3 languages: preferred briefing + app language, country (ISO 3166 alpha-2, weights regional news), quiz answers
alter table public.profiles add column if not exists language text not null default 'en' check (language in ('en','de','nl'));
alter table public.profiles add column if not exists country text check (country ~ '^[A-Z]{2}$');
alter table public.profiles add column if not exists quiz jsonb;

-- v1.4 library: every briefing a user made (newest first), audio in the private bucket "briefings/<user_id>/<job_id>.mp3"
create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id text, created_at timestamptz not null default now(),
  host text, language text, length_min int, question text, summary text, stories int, duration_s int, audio_path text, result jsonb
);
create index if not exists briefings_user_created on public.briefings (user_id, created_at desc);
alter table public.briefings enable row level security;
create policy "own briefings: read" on public.briefings for select to authenticated using (user_id = (select auth.uid()));
create policy "own briefings: insert" on public.briefings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own briefings: delete" on public.briefings for delete to authenticated using (user_id = (select auth.uid()));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('briefings', 'briefings', false, 20971520, array['audio/mpeg']) on conflict (id) do nothing;
create policy "own briefing audio: read" on storage.objects for select to authenticated using (bucket_id = 'briefings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own briefing audio: upload" on storage.objects for insert to authenticated with check (bucket_id = 'briefings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own briefing audio: update" on storage.objects for update to authenticated using (bucket_id = 'briefings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own briefing audio: delete" on storage.objects for delete to authenticated using (bucket_id = 'briefings' and (storage.foldername(name))[1] = (select auth.uid())::text);
