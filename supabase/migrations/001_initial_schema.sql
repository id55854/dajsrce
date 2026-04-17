-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- INSTITUTIONS
create table public.institutions (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  category text not null,
  description text not null,
  address text not null,
  city text not null default 'Zagreb',
  lat double precision not null,
  lng double precision not null,
  phone text,
  email text,
  website text,
  working_hours text,
  drop_off_hours text,
  accepts_donations text[] default '{}',
  capacity text,
  served_population text not null,
  photo_url text,
  is_verified boolean default true,
  is_location_hidden boolean default false,
  approximate_area text,
  nearest_zet_stop text,
  zet_lines text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- USER PROFILES
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  name text not null,
  role text not null default 'individual' check (role in ('individual', 'ngo', 'company', 'superadmin')),
  neighborhood text,
  interests text[] default '{}',
  institution_id uuid references public.institutions(id),
  total_pledges integer default 0,
  total_confirmed integer default 0,
  total_volunteer_hours integer default 0,
  badges text[] default '{}',
  created_at timestamptz default now()
);

-- NEEDS
create table public.needs (
  id uuid default uuid_generate_v4() primary key,
  institution_id uuid references public.institutions(id) on delete cascade not null,
  title text not null,
  description text not null,
  donation_type text not null,
  urgency text not null default 'routine' check (urgency in ('routine', 'needed_soon', 'urgent')),
  quantity_needed integer,
  quantity_pledged integer default 0,
  quantity_delivered integer default 0,
  photo_url text,
  deadline timestamptz,
  is_fulfilled boolean default false,
  created_at timestamptz default now()
);

-- VOLUNTEER EVENTS
create table public.volunteer_events (
  id uuid default uuid_generate_v4() primary key,
  institution_id uuid references public.institutions(id) on delete cascade not null,
  title text not null,
  description text not null,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  volunteers_needed integer not null default 5,
  volunteers_signed_up integer default 0,
  requirements text,
  contact_person text,
  contact_phone text,
  created_at timestamptz default now()
);

-- PLEDGES
create table public.pledges (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  need_id uuid references public.needs(id) on delete cascade not null,
  quantity integer default 1,
  message text,
  status text default 'pledged' check (status in ('pledged', 'delivered', 'confirmed', 'cancelled')),
  created_at timestamptz default now()
);

-- VOLUNTEER SIGNUPS
create table public.volunteer_signups (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  event_id uuid references public.volunteer_events(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

-- EMERGENCY ALERTS
create table public.emergency_alerts (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  message text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ROW LEVEL SECURITY
alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.needs enable row level security;
alter table public.volunteer_events enable row level security;
alter table public.pledges enable row level security;
alter table public.volunteer_signups enable row level security;
alter table public.emergency_alerts enable row level security;

create policy "Institutions are viewable by everyone" on public.institutions for select using (true);
create policy "Institution users can update their own" on public.institutions for update using (
  auth.uid() in (select id from public.profiles where institution_id = institutions.id)
);

create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "Needs are viewable by everyone" on public.needs for select using (true);
create policy "Institution users can create needs" on public.needs for insert with check (
  institution_id in (select institution_id from public.profiles where id = auth.uid())
);
create policy "Institution users can update own needs" on public.needs for update using (
  institution_id in (select institution_id from public.profiles where id = auth.uid())
);

create policy "Events are viewable by everyone" on public.volunteer_events for select using (true);
create policy "Institution users can create events" on public.volunteer_events for insert with check (
  institution_id in (select institution_id from public.profiles where id = auth.uid())
);

create policy "Users can view own pledges" on public.pledges for select using (auth.uid() = user_id);
create policy "Users can create pledges" on public.pledges for insert with check (auth.uid() = user_id);
create policy "Institutions can view pledges for their needs" on public.pledges for select using (
  need_id in (select id from public.needs where institution_id in (select institution_id from public.profiles where id = auth.uid()))
);

create policy "Users can view own signups" on public.volunteer_signups for select using (auth.uid() = user_id);
create policy "Users can sign up" on public.volunteer_signups for insert with check (auth.uid() = user_id);

create policy "Alerts are viewable by everyone" on public.emergency_alerts for select using (true);

-- INDEXES
create index idx_institutions_category on public.institutions(category);
create index idx_institutions_city on public.institutions(city);
create index idx_needs_institution on public.needs(institution_id);
create index idx_needs_urgency on public.needs(urgency);
create index idx_needs_fulfilled on public.needs(is_fulfilled);
create index idx_pledges_user on public.pledges(user_id);
create index idx_pledges_need on public.pledges(need_id);
create index idx_volunteer_events_date on public.volunteer_events(event_date);

-- AUTO-UPDATE TRIGGER
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger institutions_updated_at
  before update on public.institutions
  for each row execute function update_updated_at();
