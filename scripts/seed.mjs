import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://wbxvpdbhddespdsscsnw.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { INSTITUTIONS } = await import("../src/lib/institutions-seed.ts");

console.log(`Seeding ${INSTITUTIONS.length} institutions...`);

const { data, error } = await supabase
  .from("institutions")
  .insert(
    INSTITUTIONS.map((inst) => ({
      ...inst,
      is_verified: true,
      photo_url: null,
    }))
  )
  .select("id");

if (error) {
  console.error("Error seeding:", error.message);
  process.exit(1);
}

console.log(`Seeded ${data?.length ?? 0} institutions successfully.`);
