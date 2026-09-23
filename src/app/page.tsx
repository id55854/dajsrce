import MapExperience from "./map/map-experience";
import { initialMapQuery } from "./map/map-state";
import { getMapBootstrap } from "@/lib/public-map-bootstrap";

export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
  }
  const bootstrap = await getMapBootstrap(initialMapQuery(params));
  return <MapExperience bootstrap={bootstrap} />;
}
