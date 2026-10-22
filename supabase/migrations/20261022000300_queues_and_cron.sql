-- Background work without Redis: pgmq queues drained by an Edge Function that
-- pg_cron invokes through pg_net.
--
-- Requires a Vault secret named `project_url` (https://<ref>.supabase.co):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'mail_sync') then
    perform pgmq.create('mail_sync');
  end if;
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'mail_messages') then
    perform pgmq.create('mail_messages');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret for pg_cron -> Edge Function calls'
    );
  end if;
end;
$$;

create function public.invoke_edge_function(
  p_function_name text,
  p_body jsonb default '{}'::jsonb,
  p_timeout_ms integer default 55000
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_cron_secret text;
begin
  select decrypted_secret into v_project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_cron_secret from vault.decrypted_secrets where name = 'cron_secret';

  if v_project_url is null then
    raise warning 'Vault secret project_url is missing; skipping % call', p_function_name;
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/' || p_function_name,
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    ),
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

revoke execute on function public.invoke_edge_function(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.invoke_edge_function(text, jsonb, integer) to service_role;

create function public.run_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.oauth_states where expires_at < now();
  delete from pgmq.a_mail_sync where archived_at < now() - interval '7 days';
  delete from pgmq.a_mail_messages where archived_at < now() - interval '7 days';
  delete from cron.job_run_details where end_time < now() - interval '3 days';
end;
$$;

revoke execute on function public.run_maintenance() from public, anon, authenticated;

select cron.schedule(
  'opportunitrack-process-queue',
  '* * * * *',
  $$select public.invoke_edge_function('process-queue')$$
);

select cron.schedule(
  'opportunitrack-renew-subscriptions',
  '0 */6 * * *',
  $$select public.invoke_edge_function('renew-subscriptions', '{}'::jsonb, 120000)$$
);

select cron.schedule(
  'opportunitrack-maintenance',
  '17 3 * * *',
  $$select public.run_maintenance()$$
);
