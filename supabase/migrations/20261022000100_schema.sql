-- Core schema for Opportunitrack: profiles, connected mailboxes, job applications,
-- status history, processed-message ledger and APNs device tokens.

create extension if not exists pgcrypto with schema extensions;

create type public.email_provider as enum ('google', 'microsoft');
create type public.email_account_status as enum ('active', 'reauth_required', 'error');
create type public.application_status as enum ('applied', 'interview', 'rejected', 'offer');
create type public.application_source as enum ('email', 'manual');
create type public.message_outcome as enum ('job_related', 'not_job_related', 'unmatched', 'failed');
create type public.apns_environment as enum ('sandbox', 'production');

create function public.normalize_label(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(btrim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g')))
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- connected email accounts
-- ---------------------------------------------------------------------------
create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.email_provider not null,
  email_address text not null,
  provider_user_id text,
  status public.email_account_status not null default 'active',
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, email_address)
);

create index email_accounts_user_id_idx on public.email_accounts (user_id);
create index email_accounts_provider_address_idx on public.email_accounts (provider, lower(email_address));

create trigger email_accounts_set_updated_at
  before update on public.email_accounts
  for each row execute function public.set_updated_at();

-- Sync internals and the Vault reference live in a separate table that clients can never read.
create table public.email_account_sync (
  account_id uuid primary key references public.email_accounts (id) on delete cascade,
  token_secret_id uuid,
  access_token_expires_at timestamptz,
  gmail_history_id numeric(20, 0),
  gmail_watch_expires_at timestamptz,
  gmail_watch_renewed_at timestamptz,
  outlook_subscription_id text unique,
  outlook_subscription_expires_at timestamptz,
  outlook_client_state text,
  updated_at timestamptz not null default now()
);

create trigger email_account_sync_set_updated_at
  before update on public.email_account_sync
  for each row execute function public.set_updated_at();

create table public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.email_provider not null,
  code_verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);

create index oauth_states_user_id_idx on public.oauth_states (user_id);

-- ---------------------------------------------------------------------------
-- job applications and their history
-- ---------------------------------------------------------------------------
create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_name text not null check (length(btrim(company_name)) > 0),
  position_title text,
  status public.application_status not null default 'applied',
  source public.application_source not null default 'manual',
  applied_at timestamptz,
  last_activity_at timestamptz not null default now(),
  notes text,
  normalized_company text generated always as (public.normalize_label(company_name)) stored,
  normalized_position text generated always as (public.normalize_label(position_title)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_company, normalized_position)
);

create index job_applications_user_activity_idx on public.job_applications (user_id, last_activity_at desc);

create table public.processed_messages (
  id uuid primary key default gen_random_uuid(),
  email_account_id uuid not null references public.email_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_message_id text not null,
  received_at timestamptz,
  outcome public.message_outcome not null,
  classifier text,
  classifier_version text,
  job_probability real,
  confidence real,
  application_id uuid references public.job_applications (id) on delete set null,
  error text,
  processed_at timestamptz not null default now(),
  unique (email_account_id, provider_message_id)
);

create index processed_messages_user_id_idx on public.processed_messages (user_id, processed_at desc);
create index processed_messages_application_id_idx on public.processed_messages (application_id);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.application_status not null,
  occurred_at timestamptz not null default now(),
  source public.application_source not null,
  email_account_id uuid references public.email_accounts (id) on delete set null,
  processed_message_id uuid references public.processed_messages (id) on delete set null,
  subject text,
  sender text,
  confidence real,
  created_at timestamptz not null default now()
);

create index application_events_application_idx on public.application_events (application_id, occurred_at desc);
create index application_events_user_id_idx on public.application_events (user_id);
create index application_events_email_account_id_idx on public.application_events (email_account_id);
create index application_events_processed_message_id_idx on public.application_events (processed_message_id);

-- Edits made by the app are logged as manual events. The email pipeline sets
-- `opportunitrack.internal` for its transaction and writes its own richer events.
create function public.job_applications_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at = now();
  end if;
  if coalesce(current_setting('opportunitrack.internal', true), '') <> 'on'
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    new.last_activity_at = greatest(new.last_activity_at, now());
  end if;
  return new;
end;
$$;

create function public.job_applications_log_manual_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('opportunitrack.internal', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.application_events (application_id, user_id, status, occurred_at, source)
    values (new.id, new.user_id, new.status, now(), 'manual');
  end if;
  return null;
end;
$$;

create trigger job_applications_before_write
  before insert or update on public.job_applications
  for each row execute function public.job_applications_before_write();

create trigger job_applications_log_manual_status
  after insert or update of status on public.job_applications
  for each row execute function public.job_applications_log_manual_status();

-- ---------------------------------------------------------------------------
-- APNs device tokens
-- ---------------------------------------------------------------------------
create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  environment public.apns_environment not null default 'production',
  bundle_id text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index device_tokens_user_id_idx on public.device_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.email_accounts enable row level security;
alter table public.email_account_sync enable row level security;
alter table public.oauth_states enable row level security;
alter table public.job_applications enable row level security;
alter table public.processed_messages enable row level security;
alter table public.application_events enable row level security;
alter table public.device_tokens enable row level security;

-- Service-only tables: RLS on with no policies, and no table privileges either.
revoke all on table public.email_account_sync from anon, authenticated;
revoke all on table public.oauth_states from anon, authenticated;

revoke insert, update, delete on table public.email_accounts from anon, authenticated;
revoke insert, update, delete on table public.processed_messages from anon, authenticated;
revoke update, delete on table public.application_events from anon, authenticated;
revoke insert, update on table public.device_tokens from anon, authenticated;
revoke insert, delete on table public.profiles from anon, authenticated;

create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "email_accounts: read own" on public.email_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "job_applications: read own" on public.job_applications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "job_applications: insert own" on public.job_applications
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "job_applications: update own" on public.job_applications
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "job_applications: delete own" on public.job_applications
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "application_events: read own" on public.application_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "application_events: insert own manual" on public.application_events
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and source = 'manual'
    and email_account_id is null
    and processed_message_id is null
    and exists (
      select 1 from public.job_applications a
      where a.id = application_id and a.user_id = (select auth.uid())
    )
  );

create policy "processed_messages: read own" on public.processed_messages
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "device_tokens: read own" on public.device_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "device_tokens: delete own" on public.device_tokens
  for delete to authenticated using ((select auth.uid()) = user_id);
