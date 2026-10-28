-- SanctuaryFlow optional cloud synchronization.
--
-- Security model:
--   * Data belongs to a workspace (a church). Users see only workspaces they
--     are members of; Row Level Security enforces this on every table.
--   * Clients never write tables directly. Changes go through SECURITY DEFINER
--     functions that check membership and role, so the desktop app only needs
--     the public anon key and the signed-in user's token. Never ship the
--     service-role key in the app.
--   * Uploads are compare-and-swap on a per-entity version and idempotent per
--     operation id, so retries after a dropped connection are safe.

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  created_by  uuid not null default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at     timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invites (
  code          text primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  role          text not null check (role in ('editor', 'viewer')),
  created_by    uuid not null references auth.users (id),
  expires_at    timestamptz not null,
  max_uses      int not null default 10,
  uses          int not null default 0
);

create sequence public.sync_change_seq;

create table public.sync_entities (
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  entity_type        text not null check (entity_type in ('song', 'service_plan', 'theme', 'slide_deck', 'media_asset')),
  entity_id          uuid not null,
  version            bigint not null check (version > 0),
  deleted            boolean not null default false,
  payload            jsonb,
  updated_by         uuid not null references auth.users (id),
  updated_by_device  text,
  updated_at         timestamptz not null default now(),
  change_seq         bigint not null,
  primary key (workspace_id, entity_type, entity_id)
);
create index sync_entities_pull on public.sync_entities (workspace_id, change_seq);

create table public.sync_applied_ops (
  op_id         uuid primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  result        jsonb not null,
  applied_at    timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.sync_entities enable row level security;
alter table public.sync_applied_ops enable row level security;

-- Membership check used by policies and functions.
create or replace function public.has_workspace_role(p_workspace uuid, p_min_role text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = p_workspace
      and m.user_id = auth.uid()
      and case p_min_role
            when 'viewer' then m.role in ('viewer', 'editor', 'owner')
            when 'editor' then m.role in ('editor', 'owner')
            when 'owner'  then m.role = 'owner'
            else false
          end
  );
$$;

-- Read-only policies. There are deliberately no insert/update/delete
-- policies: all writes go through the functions below.
create policy "members read their workspaces" on public.workspaces
  for select using (public.has_workspace_role(id, 'viewer'));
create policy "members read membership" on public.workspace_members
  for select using (public.has_workspace_role(workspace_id, 'viewer'));
create policy "owners read invites" on public.workspace_invites
  for select using (public.has_workspace_role(workspace_id, 'owner'));
create policy "members read synced content" on public.sync_entities
  for select using (public.has_workspace_role(workspace_id, 'viewer'));

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  insert into workspaces (name, created_by) values (p_name, auth.uid()) returning id into v_id;
  insert into workspace_members (workspace_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end;
$$;

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
  -- gen_random_uuid() is built into PostgreSQL 13+ (no extension needed).
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into workspace_invites (code, workspace_id, role, created_by, expires_at)
  values (v_code, p_workspace, p_role, auth.uid(), now() + make_interval(days => greatest(1, least(p_days, 30))));
  return v_code;
end;
$$;

create or replace function public.accept_workspace_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_inv workspace_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  select * into v_inv from workspace_invites where code = upper(trim(p_code)) for update;
  if not found or v_inv.expires_at < now() or v_inv.uses >= v_inv.max_uses then
    raise exception 'the invite code is invalid or has expired' using errcode = '22023';
  end if;
  insert into workspace_members (workspace_id, user_id, role)
  values (v_inv.workspace_id, auth.uid(), v_inv.role)
  on conflict (workspace_id, user_id) do nothing;
  update workspace_invites set uses = uses + 1 where code = v_inv.code;
  return v_inv.workspace_id;
end;
$$;

-- Upload one change. Returns {"status":"applied","version":n} or
-- {"status":"conflict","remote":{...}} without writing anything.
create or replace function public.sync_push(
  p_workspace     uuid,
  p_op_id         uuid,
  p_entity_type   text,
  p_entity_id     uuid,
  p_base_version  bigint,
  p_deleted       boolean,
  p_payload       jsonb,
  p_device_id     text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_prev  jsonb;
  v_cur   sync_entities%rowtype;
  v_ver   bigint;
  v_res   jsonb;
begin
  if not has_workspace_role(p_workspace, 'editor') then
    raise exception 'you do not have permission to change this workspace' using errcode = '42501';
  end if;
  if p_payload is not null and pg_column_size(p_payload) > 4 * 1024 * 1024 then
    raise exception 'the item is too large to synchronize' using errcode = '54000';
  end if;

  -- Idempotency: a retried operation returns its original result.
  select result into v_prev from sync_applied_ops where op_id = p_op_id;
  if found then
    return v_prev;
  end if;

  select * into v_cur from sync_entities
   where workspace_id = p_workspace and entity_type = p_entity_type and entity_id = p_entity_id
   for update;

  -- Conflict when the server moved on since the client's base version and the
  -- newer server version came from another device.
  if found and v_cur.version is distinct from p_base_version
     and coalesce(v_cur.updated_by_device, '') <> coalesce(p_device_id, '') then
    return jsonb_build_object(
      'status', 'conflict',
      'remote', jsonb_build_object(
        'entityType', v_cur.entity_type,
        'entityId', v_cur.entity_id,
        'version', v_cur.version,
        'deleted', v_cur.deleted,
        'payload', v_cur.payload,
        'updatedByDevice', v_cur.updated_by_device,
        'updatedAt', v_cur.updated_at));
  end if;

  v_ver := coalesce(v_cur.version, 0) + 1;
  insert into sync_entities (workspace_id, entity_type, entity_id, version, deleted, payload, updated_by,
                             updated_by_device, updated_at, change_seq)
  values (p_workspace, p_entity_type, p_entity_id, v_ver, p_deleted, case when p_deleted then null else p_payload end,
          auth.uid(), p_device_id, now(), nextval('sync_change_seq'))
  on conflict (workspace_id, entity_type, entity_id) do update
    set version = excluded.version,
        deleted = excluded.deleted,
        payload = excluded.payload,
        updated_by = excluded.updated_by,
        updated_by_device = excluded.updated_by_device,
        updated_at = excluded.updated_at,
        change_seq = excluded.change_seq;

  v_res := jsonb_build_object('status', 'applied', 'version', v_ver);
  insert into sync_applied_ops (op_id, workspace_id, result) values (p_op_id, p_workspace, v_res);
  return v_res;
end;
$$;

-- Download changes after a cursor, oldest first.
create or replace function public.sync_pull(p_workspace uuid, p_cursor bigint, p_limit int default 200)
returns table (
  entity_type text, entity_id uuid, version bigint, deleted boolean, payload jsonb,
  updated_by_device text, updated_at timestamptz, change_seq bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not has_workspace_role(p_workspace, 'viewer') then
    raise exception 'you are not a member of this workspace' using errcode = '42501';
  end if;
  return query
    select e.entity_type, e.entity_id, e.version, e.deleted, e.payload, e.updated_by_device, e.updated_at, e.change_seq
      from sync_entities e
     where e.workspace_id = p_workspace and e.change_seq > p_cursor
     order by e.change_seq
     limit greatest(1, least(p_limit, 500));
end;
$$;

revoke all on function public.sync_push(uuid, uuid, text, uuid, bigint, boolean, jsonb, text) from public, anon;
revoke all on function public.sync_pull(uuid, bigint, int) from public, anon;
revoke all on function public.create_workspace(text) from public, anon;
revoke all on function public.create_workspace_invite(uuid, text, int) from public, anon;
revoke all on function public.accept_workspace_invite(text) from public, anon;
grant execute on function public.sync_push(uuid, uuid, text, uuid, bigint, boolean, jsonb, text) to authenticated;
grant execute on function public.sync_pull(uuid, bigint, int) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.create_workspace_invite(uuid, text, int) to authenticated;
grant execute on function public.accept_workspace_invite(text) to authenticated;
