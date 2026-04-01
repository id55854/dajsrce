create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_institution_id uuid;
  user_role text;
  inst_name text;
begin
  user_role := coalesce(new.raw_user_meta_data->>'role', 'citizen');
  inst_name := new.raw_user_meta_data->>'institution_name';

  if user_role = 'institution' and inst_name is not null and inst_name != '' then
    insert into public.institutions (name, category, description, address, city, lat, lng, served_population, is_verified)
    values (inst_name, 'social_welfare', inst_name || ' - registered via DajSrce', 'Address pending', 'Zagreb', 45.8131, 15.9775, 'General', false)
    returning id into new_institution_id;
  end if;

  insert into public.profiles (id, email, name, role, institution_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    user_role,
    new_institution_id
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
