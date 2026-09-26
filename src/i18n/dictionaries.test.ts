import { describe, expect, it } from "vitest";
import { dictionaries, format, pluralKey, resolveKey } from "./dictionaries";

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

  it("picks the Croatian plural form from the whole number, not its last digit alone", () => {
    const form = (count: number) => pluralKey("map_page.search_count", "hr", count).split("_").pop();
    expect([1, 21, 101].map(form)).toEqual(["one", "one", "one"]);
    expect([2, 4, 22, 273].map(form)).toEqual(["few", "few", "few", "few"]);
    expect([0, 5, 11, 12, 14, 111, 3128].map(form)).toEqual(Array(7).fill("other"));
    expect([1, 2, 5].map((count) => pluralKey("map_page.search_count", "en", count))).toEqual([
      "map_page.search_count_one",
      "map_page.search_count_other",
      "map_page.search_count_other",
    ]);
    expect(format(resolveKey(dictionaries.hr, pluralKey("map_page.search_count", "hr", 131)), { count: 131 }))
      .toBe("131 pronađena udruga u cijeloj Hrvatskoj");
    expect(format(resolveKey(dictionaries.hr, pluralKey("map_ui.cluster_count", "hr", 273)), { count: 273 }))
      .toBe("273 udruge");
  });

  it("defines every plural variant a counted key can select, in both locales", () => {
    // The map's counted strings go through `pluralKey`; older calendar keys
    // use their own one/other pair and are not part of this contract.
    const bases = [...hr.keys()]
      .filter((key) => /^map_(page|ui)\./.test(key) && key.endsWith("_one"))
      .map((key) => key.slice(0, -"_one".length));
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) {
      for (const variant of ["one", "few", "other"]) {
        expect(hr.has(`${base}_${variant}`), `${base}_${variant}`).toBe(true);
        expect(en.has(`${base}_${variant}`), `${base}_${variant}`).toBe(true);
      }
    }
  });

  it("returns the key for missing values and preserves unknown placeholders", () => {
    expect(resolveKey(dictionaries.en, "missing.key")).toBe("missing.key");
    expect(format("Hello {name} from {place}", { name: "Ana" })).toBe(
      "Hello Ana from {place}"
    );
  });
});
