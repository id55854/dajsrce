import { redirect } from "next/navigation";

// `/dashboard/ngo` and `/dashboard/institution` are the same product surface:
// every NGO sub-feature (pledges, volunteers) already lives under
// `/dashboard/institution/*`, those pages link "Back" to
// `/dashboard/institution`, and middleware gates both paths on the same `ngo`
// role. This route used to `export { default } from "../institution/page"`,
// which rendered a page titled "Institution Management" at an /ngo URL.
// Redirecting keeps one canonical URL per surface instead of inventing a second
// title for identical content. `roleToDashboardPath("ngo")` still points here,
// so the role dispatch is untouched.
export default function NgoDashboardPage() {
  redirect("/dashboard/institution");
}
