-- RPCs used by Edge Functions (service_role only) plus one RPC for the iOS app.

-- ---------------------------------------------------------------------------
-- OAuth tokens in Supabase Vault
-- ---------------------------------------------------------------------------
create function public.store_account_tokens(
  p_account_id uuid,
  p_tokens jsonb,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select token_secret_id into v_secret_id
  from public.email_account_sync
  where account_id = p_account_id
  for update;

  if not found then
    raise exception 'unknown email account %', p_account_id using errcode = 'P0002';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_tokens::text,
      'email_account_tokens:' || p_account_id::text,
      'OAuth tokens for an Opportunitrack email account'
    );
  else
    perform vault.update_secret(v_secret_id, p_tokens::text);
  end if;

  update public.email_account_sync
  set token_secret_id = v_secret_id,
      access_token_expires_at = p_expires_at
  where account_id = p_account_id;
end;
$$;

create function public.get_account_tokens(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret::jsonb
  from public.email_account_sync sync
  join vault.decrypted_secrets s on s.id = sync.token_secret_id
  where sync.account_id = p_account_id
$$;

create function public.delete_account_tokens(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select token_secret_id into v_secret_id
  from public.email_account_sync
  where account_id = p_account_id
  for update;

  update public.email_account_sync
  set token_secret_id = null, access_token_expires_at = null
  where account_id = p_account_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

-- Deleting an account (directly or via auth user cascade) must not leave tokens behind.
create function public.email_account_sync_delete_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.token_secret_id is not null then
    delete from vault.secrets where id = old.token_secret_id;
  end if;
  return old;
end;
$$;

create trigger email_account_sync_delete_secret
  after delete on public.email_account_sync
  for each row execute function public.email_account_sync_delete_secret();

-- ---------------------------------------------------------------------------
-- Idempotent write of one classified email
-- ---------------------------------------------------------------------------
create function public.record_classified_message(
  p_account_id uuid,
  p_provider_message_id text,
  p_received_at timestamptz,
  p_outcome public.message_outcome,
  p_classifier text default null,
  p_classifier_version text default null,
  p_job_probability real default null,
  p_confidence real default null,
  p_company text default null,
  p_position text default null,
  p_status public.application_status default null,
  p_subject text default null,
  p_sender text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_message_id uuid;
  v_app public.job_applications%rowtype;
  v_company text := nullif(btrim(p_company), '');
  v_position text := nullif(btrim(p_position), '');
  v_norm_company text := public.normalize_label(p_company);
  v_norm_position text := public.normalize_label(p_position);
  v_occurred_at timestamptz := coalesce(p_received_at, now());
  v_created boolean := false;
  v_status_changed boolean := false;
  v_previous_status public.application_status;
begin
  select user_id into v_user_id from public.email_accounts where id = p_account_id;
  if not found then
    raise exception 'unknown email account %', p_account_id using errcode = 'P0002';
  end if;

  insert into public.processed_messages (
    email_account_id, user_id, provider_message_id, received_at, outcome,
    classifier, classifier_version, job_probability, confidence, error
  )
  values (
    p_account_id, v_user_id, p_provider_message_id, p_received_at, p_outcome,
    p_classifier, p_classifier_version, p_job_probability, p_confidence, p_error
  )
  on conflict (email_account_id, provider_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if p_outcome <> 'job_related' or v_company is null or p_status is null then
    return jsonb_build_object('duplicate', false, 'processed_message_id', v_message_id);
  end if;

  perform set_config('opportunitrack.internal', 'on', true);

  -- Match the same company; an email without a detected position (or an
  -- application without one) matches the most recently active application.
  select * into v_app
  from public.job_applications a
  where a.user_id = v_user_id
    and a.normalized_company = v_norm_company
    and (a.normalized_position = v_norm_position or v_norm_position = '' or a.normalized_position = '')
  order by (a.normalized_position = v_norm_position) desc, a.last_activity_at desc
  limit 1
  for update;

  if not found then
    insert into public.job_applications (
      user_id, company_name, position_title, status, source, applied_at, last_activity_at
    )
    values (
      v_user_id, v_company, v_position, p_status, 'email',
      case when p_status = 'applied' then v_occurred_at end,
      v_occurred_at
    )
    returning * into v_app;
    v_created := true;
    v_status_changed := true;
  else
    v_previous_status := v_app.status;
    if v_occurred_at >= v_app.last_activity_at then
      v_status_changed := v_app.status is distinct from p_status;
      update public.job_applications
      set status = p_status,
          last_activity_at = v_occurred_at,
          position_title = coalesce(position_title, v_position),
          applied_at = coalesce(applied_at, case when p_status = 'applied' then v_occurred_at end)
      where id = v_app.id
      returning * into v_app;
    else
      update public.job_applications
      set position_title = coalesce(position_title, v_position),
          applied_at = coalesce(applied_at, case when p_status = 'applied' then v_occurred_at end)
      where id = v_app.id
      returning * into v_app;
    end if;
  end if;

  insert into public.application_events (
    application_id, user_id, status, occurred_at, source,
    email_account_id, processed_message_id, subject, sender, confidence
  )
  values (
    v_app.id, v_user_id, p_status, v_occurred_at, 'email',
    p_account_id, v_message_id, left(p_subject, 500), left(p_sender, 320), p_confidence
  );

  update public.processed_messages set application_id = v_app.id where id = v_message_id;

  return jsonb_build_object(
    'duplicate', false,
    'processed_message_id', v_message_id,
    'application_id', v_app.id,
    'user_id', v_user_id,
    'company_name', v_app.company_name,
    'position_title', v_app.position_title,
    'status', v_app.status,
    'previous_status', v_previous_status,
    'created', v_created,
    'status_changed', v_status_changed
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- pgmq wrappers (PostgREST only exposes `public`)
-- ---------------------------------------------------------------------------
create function public.queue_send(queue_name text, message jsonb, delay_seconds integer default 0)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select * from pgmq.send(queue_name, message, delay_seconds)
$$;

create function public.queue_read(queue_name text, visibility_timeout integer, quantity integer)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, message jsonb)
language sql
security definer
set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.enqueued_at, r.message
  from pgmq.read(queue_name, visibility_timeout, quantity) r
$$;

create function public.queue_delete(queue_name text, message_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete(queue_name, message_id)
$$;

create function public.queue_archive(queue_name text, message_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.archive(queue_name, message_id)
$$;

-- ---------------------------------------------------------------------------
-- Cron authentication
-- ---------------------------------------------------------------------------
create function public.verify_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets
    where name = 'cron_secret' and decrypted_secret = p_secret
  )
$$;

-- ---------------------------------------------------------------------------
-- iOS app: register an APNs token for the signed-in user
-- ---------------------------------------------------------------------------
create function public.register_device_token(
  p_token text,
  p_environment public.apns_environment default 'production',
  p_bundle_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token !~ '^[0-9a-fA-F]{32,200}$' then
    raise exception 'invalid device token' using errcode = '22023';
  end if;

  insert into public.device_tokens (user_id, token, environment, bundle_id, last_seen_at)
  values (auth.uid(), lower(p_token), p_environment, p_bundle_id, now())
  on conflict (token) do update
  set user_id = excluded.user_id,
      environment = excluded.environment,
      bundle_id = excluded.bundle_id,
      last_seen_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.store_account_tokens(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.get_account_tokens(uuid) from public, anon, authenticated;
revoke execute on function public.delete_account_tokens(uuid) from public, anon, authenticated;
revoke execute on function public.record_classified_message(uuid, text, timestamptz, public.message_outcome, text, text, real, real, text, text, public.application_status, text, text, text) from public, anon, authenticated;
revoke execute on function public.queue_send(text, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.queue_read(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.queue_delete(text, bigint) from public, anon, authenticated;
revoke execute on function public.queue_archive(text, bigint) from public, anon, authenticated;
revoke execute on function public.verify_cron_secret(text) from public, anon, authenticated;
revoke execute on function public.email_account_sync_delete_secret() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.job_applications_log_manual_status() from public, anon, authenticated;

grant execute on function public.store_account_tokens(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.get_account_tokens(uuid) to service_role;
grant execute on function public.delete_account_tokens(uuid) to service_role;
grant execute on function public.record_classified_message(uuid, text, timestamptz, public.message_outcome, text, text, real, real, text, text, public.application_status, text, text, text) to service_role;
grant execute on function public.queue_send(text, jsonb, integer) to service_role;
grant execute on function public.queue_read(text, integer, integer) to service_role;
grant execute on function public.queue_delete(text, bigint) to service_role;
grant execute on function public.queue_archive(text, bigint) to service_role;
grant execute on function public.verify_cron_secret(text) to service_role;

revoke execute on function public.register_device_token(text, public.apns_environment, text) from public, anon;
grant execute on function public.register_device_token(text, public.apns_environment, text) to authenticated;
