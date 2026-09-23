-- Postgres moved from Supabase to Neon; Supabase Auth stays the identity
-- provider. The Neon Data API (PostgREST-compatible) serves the app's
-- `.from()`/`.rpc()` calls with short-lived ES256 tokens the app signs
-- (public/.well-known/jwks.json). pg_session_jwt provides auth.uid() and
-- auth.jwt() from those tokens, so existing policies and functions keep
-- working unchanged.
--
-- Neon-only prerequisites (created by the Data API or by hand, not here):
-- roles authenticator/authenticated/anonymous, schema auth (pg_session_jwt),
-- extensions in schema `extensions`.

-- 1. API roles. `anon` and `service_role` mirror Supabase's roles so every
--    existing grant keeps its meaning; the Data API's anon role is `anon`.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- The token's role claim picks one of exactly three roles; Neon itself
-- grants `authenticated` (and its unused `anonymous`) to authenticator.
grant anon to authenticator;
grant service_role to authenticator;

grant usage on schema public, extensions to anon, authenticated, service_role;

-- Supabase parity for later migrations: new objects are granted to the API
-- roles and protected by RLS and explicit revokes, as supabase_admin's
-- default privileges did.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- 2. auth.users stays in Supabase, so the foreign key and the
--    on_auth_user_created trigger cannot follow it.
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- 3. The replacement for handle_new_user(): the app calls this once per
--    process per user, with the caller's own token. Same least-privileged
--    insert, same name fallback; identity comes only from the verified token.
create or replace function public.ensure_own_profile()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_email text := coalesce(v_claims->>'email', '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.profiles (id, email, name, role)
  values (
    v_uid,
    v_email,
    coalesce(
      nullif(left(v_claims->'user_metadata'->>'name', 200), ''),
      nullif(split_part(v_email, '@', 1), ''),
      'User'
    ),
    'individual'
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.ensure_own_profile() from public, anon, service_role;
grant execute on function public.ensure_own_profile() to authenticated;
