import { permanentRedirect } from "next/navigation";

/**
 * Open needs are now one view of the merged Associations page. The route stays
 * as a 308 so existing links, shared URLs and the indexed address keep working.
 */
export default function NeedsRedirect() {
  permanentRedirect("/organisations?view=needs");
}
