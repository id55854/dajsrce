import { permanentRedirect } from "next/navigation";

/**
 * The "find help" wizard is now one view of the merged Associations page. The
 * route stays as a 308 so existing links keep working.
 */
export default function QuickStartRedirect() {
  permanentRedirect("/organisations?view=help");
}
