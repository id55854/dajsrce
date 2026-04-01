DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_institution_id uuid;
  user_role text;
  inst_name text;
BEGIN
  user_role := coalesce(new.raw_user_meta_data->>'role', 'citizen');
  inst_name := new.raw_user_meta_data->>'institution_name';

  IF user_role = 'institution' AND inst_name IS NOT NULL AND inst_name != '' THEN
    INSERT INTO public.institutions (name, category, description, address, city, lat, lng, served_population, is_verified)
    VALUES (inst_name, 'social_welfare', inst_name || ' - registered via DajSrce', 'Address pending', 'Zagreb', 45.8131, 15.9775, 'General', false)
    RETURNING id INTO new_institution_id;
  END IF;

  INSERT INTO public.profiles (id, email, name, role, institution_id)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    user_role,
    new_institution_id
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
