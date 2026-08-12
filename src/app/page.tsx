import MapExperience from "./map/map-experience";

/**
 * The map is the product, so it is the home page: `dajsrce.hr` opens straight
 * onto it rather than redirecting to `/map`. `/map` is kept as a permanent
 * redirect for links and bookmarks that predate this.
 *
 * Title and description come from the root layout's `generateMetadata`, which
 * already describes the map.
 */
export default function Home() {
  return <MapExperience />;
}
