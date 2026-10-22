-- Lets workers push a job back by a provider's Retry-After (Graph throttling, Gmail 429s).

create function public.queue_set_visibility(queue_name text, message_id bigint, visibility_timeout integer)
returns void
language sql
security definer
set search_path = ''
as $$
  select null from pgmq.set_vt(queue_name, message_id, visibility_timeout)
$$;

revoke execute on function public.queue_set_visibility(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.queue_set_visibility(text, bigint, integer) to service_role;
