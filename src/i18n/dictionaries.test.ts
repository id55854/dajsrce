import { describe, expect, it } from "vitest";
import { dictionaries, format, resolveKey } from "./dictionaries";

function flatten(
  value: Record<string, unknown>,
  prefix = ""
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") result.set(path, child);
    else if (child && typeof child === "object") {
      for (const [nestedKey, nestedValue] of flatten(
        child as Record<string, unknown>,
        path
      )) {
        result.set(nestedKey, nestedValue);
      }
    }
  }
  return result;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("translation dictionaries", () => {
  const hr = flatten(dictionaries.hr);
  const en = flatten(dictionaries.en);

  it("keeps exact key and placeholder parity between locales", () => {
    expect([...en.keys()].sort()).toEqual([...hr.keys()].sort());
    for (const key of en.keys()) {
      expect(placeholders(en.get(key)!)).toEqual(placeholders(hr.get(key)!));
    }
  });

  it("contains no empty translations", () => {
    for (const translations of [hr, en]) {
      for (const value of translations.values()) expect(value.trim()).not.toBe("");
    }
  });

  it("returns the key for missing values and preserves unknown placeholders", () => {
    expect(resolveKey(dictionaries.en, "missing.key")).toBe("missing.key");
    expect(format("Hello {name} from {place}", { name: "Ana" })).toBe(
      "Hello Ana from {place}"
    );
  });
});
