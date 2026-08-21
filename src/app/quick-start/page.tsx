import { permanentRedirect } from "next/navigation";

/**
 * The donation wizard is now one view of the Donate page. The route stays as a
 * 308 so existing links keep working.
 */
export default function QuickStartRedirect() {
  permanentRedirect("/doniraj?view=explore");
}
