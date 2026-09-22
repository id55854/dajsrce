import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("public list snapshots", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("keeps filters isolated and preserves a successfully loaded empty list", async () => {
    const { readPublicList, rememberPublicList } = await import("./public-list-cache");
    rememberPublicList("/api/needs?categories=elderly", [{ id: "need" }]);
    rememberPublicList("/api/volunteer-events", []);
    expect(readPublicList("/api/needs?categories=elderly")).toEqual([{ id: "need" }]);
    expect(readPublicList("/api/needs?")).toBeUndefined();
    expect(readPublicList("/api/volunteer-events")).toEqual([]);
  });

  it("expires old snapshots instead of showing outdated data on return", async () => {
    const { readPublicList, rememberPublicList } = await import("./public-list-cache");
    rememberPublicList("/api/needs?", [{ id: "old" }]);
    vi.advanceTimersByTime(29_999);
    expect(readPublicList("/api/needs?")).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(readPublicList("/api/needs?")).toBeUndefined();
  });

  it("bounds memory and replaces the previous snapshot after a refresh", async () => {
    const { readPublicList, rememberPublicList } = await import("./public-list-cache");
    for (let i = 0; i < 21; i++) rememberPublicList(`/api/needs?page=${i}`, [i]);
    expect(readPublicList("/api/needs?page=0")).toBeUndefined();
    expect(readPublicList("/api/needs?page=1")).toEqual([1]);
    rememberPublicList("/api/needs?page=1", [99]);
    rememberPublicList("/api/needs?page=21", [21]);
    expect(readPublicList("/api/needs?page=1")).toEqual([99]);
    expect(readPublicList("/api/needs?page=2")).toBeUndefined();
  });
});
