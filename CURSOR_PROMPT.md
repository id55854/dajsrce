# DajSrce Bug Fix Prompt for Cursor

Copy everything below this line and paste it into Cursor as a single prompt.

---

## Task: Fix all broken user flows in DajSrce

There are **6 critical bugs** preventing the core functionality from working. I need you to fix all of them. Here is the exact diagnosis for each one:

---

### BUG 1 (CRITICAL): No profile is created when a user registers

**Files:** `src/app/auth/register/page.tsx`, `supabase/migrations/001_initial_schema.sql`

**Problem:** When a user signs up via `supabase.auth.signUp()` in `register/page.tsx` (line 57), the user is created in `auth.users` but **NO row is ever inserted into `public.profiles`**. The registration data (name, role, institution_name) is stored only in `auth.users.user_metadata` and never written to the `profiles` table.

This breaks EVERYTHING downstream because:
- The pledge API (`api/pledges/route.ts` line 68-79) tries to read the profile to increment `total_pledges` — profile doesn't exist, so it silently fails
- The volunteer signup API (`api/volunteer-signups/route.ts`) inserts with `user_id` referencing `profiles(id)` — this fails due to foreign key constraint since no profile row exists
- The needs API (`api/needs/route.ts` line 62-68) checks `profile.role !== "institution"` — profile is null, so it always returns 403
- The volunteer events API (`api/volunteer-events/route.ts` line 37-43) has the same profile check — always 403

**Fix:** There are two complementary fixes needed:

**Fix 1a — Database trigger:** Add a new migration file `supabase/migrations/002_create_profile_trigger.sql` that creates a trigger function to automatically create a profile row whenever a new user is created in `auth.users`. The function should read `name`, `role`, and `email` from `new.raw_user_meta_data` and insert into `public.profiles`. Use `SECURITY DEFINER` since the trigger runs in auth context.

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'citizen')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Fix 1b — Client-side fallback:** After successful signup in `register/page.tsx`, if `data.session` exists (meaning email confirmation is disabled and user is immediately logged in), also insert the profile row directly via the Supabase client before redirecting. This handles the case where the trigger hasn't been deployed yet or for existing users who don't have profiles:

```typescript
if (data.session && data.user) {
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({
      id: data.user.id,
      email,
      name,
      role: role!,
    }, { onConflict: "id" });
  // continue to redirect even if this fails (trigger should handle it)
}
```

---

### BUG 2 (CRITICAL): Institution registration doesn't create an institution or link it to the profile

**Files:** `src/app/auth/register/page.tsx`, `src/app/auth/callback/route.ts`

**Problem:** When a user registers as an "institution" role, they enter an `institutionName` but this value is ONLY stored in `auth.users.user_metadata` as `institution_name`. No row is ever created in the `institutions` table, and the profile's `institution_id` is never set.

The callback route (`auth/callback/route.ts` line 31) tries to redirect new OAuth users to `/auth/setup` — but **that page doesn't exist** (there is no `src/app/auth/setup/` directory). And even if it did, email-based registrations skip the callback entirely (they go straight to `/dashboard` on line 79 of register/page.tsx).

**Result:** Institution users can see the dashboard with "New Need" and "New Event" buttons, but every submission returns 403 because `profile.institution_id` is null.

**Fix:** After creating the profile in the registration flow (Fix 1b above), if the role is "institution", also create an institution row and link it:

In `src/app/auth/register/page.tsx`, after the profile upsert, add:

```typescript
if (role === "institution" && data.user) {
  // Create the institution
  const { data: inst } = await supabase
    .from("institutions")
    .insert({
      name: institutionName.trim(),
      category: "social_welfare",  // default, user can change later
      description: `${institutionName.trim()} - registered via DajSrce`,
      address: "Address pending",
      city: "Zagreb",
      lat: 45.8131,  // Zagreb center default
      lng: 15.9775,
      served_population: "General",
      is_verified: false,
    })
    .select("id")
    .single();

  if (inst) {
    await supabase
      .from("profiles")
      .update({ institution_id: inst.id })
      .eq("id", data.user.id);
  }
}
```

Also update the database trigger (Fix 1a) to handle institution creation from user_metadata for the OAuth flow:

```sql
create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_institution_id uuid;
  user_role text;
  inst_name text;
begin
  user_role := coalesce(new.raw_user_meta_data->>'role', 'citizen');
  inst_name := new.raw_user_meta_data->>'institution_name';

  -- Create institution if role is institution and name provided
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
```

---

### BUG 3 (CRITICAL): PledgeButton doesn't send auth cookies

**File:** `src/components/PledgeButton.tsx`, line 48

**Problem:** The fetch call to `/api/pledges` does NOT include `credentials: "include"`. Without this, the browser doesn't send cookies, so the server-side `supabase.auth.getUser()` returns null, and the API returns 401.

Compare to `src/app/dashboard/institution/page.tsx` line 57 which correctly includes `credentials: "include"`.

**Fix:** Add `credentials: "include"` to the fetch call in the `submit` function:

```typescript
const res = await fetch("/api/pledges", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",  // <-- ADD THIS
  body: JSON.stringify({
    need_id: needId,
    quantity,
    message: message.trim() || undefined,
  }),
});
```

---

### BUG 4 (CRITICAL): VolunteerEventCard doesn't send auth cookies

**File:** `src/components/VolunteerEventCard.tsx`, line 41

**Problem:** Identical to Bug 3 — the fetch to `/api/volunteer-signups` is missing `credentials: "include"`, so the server can't identify the user and returns 401.

**Fix:** Add `credentials: "include"`:

```typescript
const res = await fetch("/api/volunteer-signups", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",  // <-- ADD THIS
  body: JSON.stringify({ event_id: event.id }),
});
```

---

### BUG 5 (CRITICAL): Institution dashboard sends wrong field name for event date

**File:** `src/app/dashboard/institution/page.tsx`, line 96

**Problem:** The `submitEvent` function sends `date: evDate` in the JSON body, but the API route (`api/volunteer-events/route.ts` line 48) destructures `event_date`. So `event_date` is `undefined`, and the database INSERT fails because `event_date date not null` is a required column.

**Fix:** Change `date` to `event_date` in the JSON body on line 96:

```typescript
body: JSON.stringify({
  title: evTitle,
  description: evDescription,
  event_date: evDate,  // <-- CHANGE FROM "date" TO "event_date"
  start_time: evStart,
  end_time: evEnd,
  volunteers_needed: Number(evVolunteers),
}),
```

---

### BUG 6 (MEDIUM): Foreign key constraint blocks pledges and volunteer signups for users without profiles

**Files:** `supabase/migrations/001_initial_schema.sql` lines 85, 96

**Problem:** The `pledges.user_id` and `volunteer_signups.user_id` columns reference `public.profiles(id)` with a foreign key constraint. If a user's profile row doesn't exist (Bug 1), these INSERTs will fail with a foreign key violation error, even if the auth session is valid.

**Fix:** This is resolved by Bug 1's fix (creating profiles on registration). However, as a safety net for existing users who registered before the fix, add a profile-creation check in both API routes.

In `src/app/api/pledges/route.ts`, after getting the user (line 31-34), add:

```typescript
// Ensure profile exists (safety net for pre-fix users)
const { data: existingProfile } = await supabase
  .from("profiles")
  .select("id")
  .eq("id", user.id)
  .maybeSingle();

if (!existingProfile) {
  await supabase.from("profiles").insert({
    id: user.id,
    email: user.email!,
    name: user.user_metadata?.name || user.email!.split("@")[0],
    role: user.user_metadata?.role || "citizen",
  });
}
```

Add the same safety net in `src/app/api/volunteer-signups/route.ts` after line 9.

---

## Summary of all changes needed:

| # | File | Change |
|---|------|--------|
| 1 | `supabase/migrations/002_create_profile_trigger.sql` | NEW FILE — trigger that auto-creates profile + institution on user signup |
| 2 | `src/app/auth/register/page.tsx` | After signup, create profile row + institution row (if institution role) client-side |
| 3 | `src/components/PledgeButton.tsx` line 48 | Add `credentials: "include"` to fetch |
| 4 | `src/components/VolunteerEventCard.tsx` line 41 | Add `credentials: "include"` to fetch |
| 5 | `src/app/dashboard/institution/page.tsx` line 96 | Change `date: evDate` to `event_date: evDate` |
| 6 | `src/app/api/pledges/route.ts` after line 34 | Add profile-exists safety net |
| 7 | `src/app/api/volunteer-signups/route.ts` after line 9 | Add profile-exists safety net |

**IMPORTANT:** After making the code changes, you also need to run the new migration `002_create_profile_trigger.sql` against the Supabase database. If you're using Supabase CLI: `supabase db push`. If using the dashboard: paste the SQL into the SQL Editor and run it.

**Test plan after fixes:**
1. Register a new citizen account → verify a profile row appears in `profiles` table
2. Register a new institution account → verify both a `profiles` row (with `institution_id` set) and an `institutions` row are created
3. As citizen: go to `/needs`, click "I can help" on any need, submit a pledge → should succeed with green toast
4. As citizen: go to `/volunteer`, click "Sign Up" on any event → should succeed showing "Signed up!"
5. As institution: go to `/dashboard/institution`, click "New Need", fill form, submit → should succeed
6. As institution: click "New Volunteer Event", fill form, submit → should succeed (event_date field now correct)
