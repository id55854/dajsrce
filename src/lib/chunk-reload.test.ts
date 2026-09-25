import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./chunk-reload";

describe("isChunkLoadError", () => {
  it("recognises webpack's stale-chunk failures", () => {
    const named = Object.assign(new Error("Loading chunk 8751 failed."), { name: "ChunkLoadError" });
    expect(isChunkLoadError(named)).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 8751 failed. (error: https://x/_next/static/chunks/8751.js)"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk app-layout failed"))).toBe(true);
  });

  it("leaves every other error to the normal boundary", () => {
    expect(isChunkLoadError(new Error("Map query failed"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("Loading chunk 1 failed")).toBe(false);
  });
});
