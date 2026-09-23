import { beforeEach, describe, expect, it, vi } from "vitest";
const { load, cache } = vi.hoisted(() => ({ load: vi.fn(), cache: vi.fn((fn: (...args: string[]) => unknown) => fn) }));
vi.mock("next/cache", () => ({ unstable_cache: cache }));
vi.mock("./public-map-data", () => ({ loadPublicMap: load }));
vi.mock("./observability", () => ({ logError: vi.fn() }));
import { getMapBootstrap } from "./public-map-bootstrap";
import { initialMapQuery } from "@/app/map/map-state";

describe("public server snapshot", () => {
  beforeEach(() => load.mockReset());
  it("caches the bounded query for five minutes without user identity", async () => {
    const response = { features: [], meta: {} };
    load.mockResolvedValue({ response, strategy: "postgis-rpc" });
    const result = await getMapBootstrap(initialMapQuery(new URLSearchParams("city=Zagreb")));
    expect(result?.response).toEqual(response);
    expect(result?.queryKey).toContain("city=Zagreb");
    expect(cache).toHaveBeenCalledWith(expect.any(Function), ["public-map-bootstrap-v1"], { revalidate: 300 });
    expect(load.mock.calls[0][0].limit).toBeLessThanOrEqual(200);
  });
  it("lets database errors escape the cached function instead of caching empty success", async () => {
    load.mockRejectedValueOnce(new Error("Database unavailable"));
    const query = initialMapQuery(new URLSearchParams());
    const cachedFunction = cache.mock.calls[0][0];
    await expect(cachedFunction("bbox=13,42,20,47&zoom=7&limit=150")).rejects.toThrow("Database unavailable");
    load.mockRejectedValueOnce(new Error("Database unavailable"));
    expect(await getMapBootstrap(query)).toBeNull();
    load.mockResolvedValueOnce({ response: { features: ["recovered"] } });
    expect((await getMapBootstrap(query))?.response.features).toEqual(["recovered"]);
  });
});
