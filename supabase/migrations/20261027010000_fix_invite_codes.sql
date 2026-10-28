-- Fix: invite codes were generated with pgcrypto's gen_random_bytes(), which
-- Supabase installs in the "extensions" schema and the function (search_path
-- = public) could not see. gen_random_uuid() is built into PostgreSQL 13+,
-- so no extension is needed. Existing grants are kept by CREATE OR REPLACE.

create or replace function public.create_workspace_invite(p_workspace uuid, p_role text, p_days int default 7)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  if not has_workspace_role(p_workspace, 'owner') then
    raise exception 'only workspace owners can invite' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into workspace_invites (code, workspace_id, role, created_by, expires_at)
  values (v_code, p_workspace, p_role, auth.uid(), now() + make_interval(days => greatest(1, least(p_days, 30))));
  return v_code;
end;
$$;
