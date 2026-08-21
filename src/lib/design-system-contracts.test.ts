import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), dir))) {
    const rel = join(dir, entry);
    const abs = resolve(process.cwd(), rel);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(rel, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(rel);
    }
  }
  return out;
}

const GLOBALS = "src/app/globals.css";

describe("design token layer", () => {
  it("defines the semantic tokens components depend on", () => {
    const css = source(GLOBALS);
    for (const token of [
      "--brand:",
      "--brand-strong:",
      "--brand-soft:",
      "--danger:",
      "--success:",
      "--warning:",
      "--info:",
      "--surface:",
      "--surface-raised:",
      "--surface-overlay:",
      "--border:",
      "--ink:",
      "--ink-secondary:",
      "--chrome:",
      "--scrim:",
      "--radius-control:",
      "--radius-card:",
      "--radius-sheet:",
      "--shadow-raised:",
      "--shadow-overlay:",
      "--shadow-modal:",
      "--z-modal:",
      "--z-toast:",
    ]) {
      expect(css, `missing token ${token}`).toContain(token);
    }
  });

  it("keeps the layering ladder single, ordered and free of four-digit escapes", () => {
    const css = source(GLOBALS);
    // One ladder for the whole app. Leaflet's panes (200-700) are contained by
    // `isolation: isolate` on the map wrapper, and Dialog portals to
    // document.body, so nothing here has to out-bid them. A four-digit value
    // is the symptom of someone fixing a stacking bug by escalation instead;
    // it worked, it silently abandoned the ladder, and no test noticed.
    const ladder = ["base", "chrome", "dropdown", "sheet", "modal", "toast"];
    const values = ladder.map((name) => {
      const raw = new RegExp(`--z-${name}:\\s*([0-9]+)\\s*;`).exec(css)?.[1];
      expect(raw, `--z-${name} is missing or not a plain integer`).toBeTruthy();
      return Number(raw);
    });

    for (let i = 1; i < values.length; i += 1) {
      expect(
        values[i],
        `--z-${ladder[i]} (${values[i]}) must sit above --z-${ladder[i - 1]} (${values[i - 1]})`
      ).toBeGreaterThan(values[i - 1]);
    }

    for (const [index, value] of values.entries()) {
      expect(
        value,
        `--z-${ladder[index]} is ${value}: the ladder stays below 1000, and a stacking bug is fixed by portalling or isolating, not by out-bidding`
      ).toBeLessThan(1000);
    }
  });

  it("overrides the theme-dependent tokens for dark mode", () => {
    const css = source(GLOBALS);
    const darkBlock = css.slice(css.indexOf(".dark {"));
    for (const token of ["--surface:", "--ink:", "--border:", "--chrome:"]) {
      expect(darkBlock, `dark mode does not override ${token}`).toContain(token);
    }
  });

  it("keeps danger visually distinct from brand so an error is not a CTA", () => {
    const css = source(GLOBALS);
    const brand = /--brand:\s*([^;]+);/.exec(css)?.[1]?.trim();
    const danger = /--danger:\s*([^;]+);/.exec(css)?.[1]?.trim();
    expect(brand).toBeTruthy();
    expect(danger).toBeTruthy();
    expect(danger).not.toEqual(brand);
  });

  it("honours the three user preference media queries", () => {
    const css = source(GLOBALS);
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("prefers-reduced-transparency");
    expect(css).toContain("prefers-contrast");
  });

  it("pairs every overlay animation with an exit", () => {
    const css = source(GLOBALS);
    for (const name of ["fade", "dialog", "menu", "sheet", "toast"]) {
      expect(css, `missing --animate-${name}-in`).toContain(`--animate-${name}-in:`);
      expect(css, `missing --animate-${name}-out`).toContain(`--animate-${name}-out:`);
      expect(css, `missing @keyframes ui-${name}-in`).toContain(`@keyframes ui-${name}-in`);
      expect(css, `missing @keyframes ui-${name}-out`).toContain(`@keyframes ui-${name}-out`);
    }
  });
});

describe("interaction primitives", () => {
  it("gives every button a press state, a focus-visible ring and a disabled state", () => {
    const button = source("src/components/ui/button-classes.ts");
    expect(button).toContain("motion-safe:active:scale-");
    expect(button).toContain("focus-visible:ring-2");
    expect(button).toContain("disabled:");
  });

  it("keeps buttonClasses callable from server components", () => {
    // A "use client" module's exports can only be rendered from the server,
    // never invoked — this helper is called directly by server components.
    const button = source("src/components/ui/button-classes.ts");
    expect(button.trimStart().startsWith('"use client"')).toBe(false);
  });

  it("wires field errors to their control programmatically", () => {
    const field = source("src/components/ui/Field.tsx");
    expect(field).toContain("aria-describedby");
    expect(field).toContain("aria-invalid");
    expect(field).toContain("htmlFor");
  });

  it("animates overlays in both directions via data-state", () => {
    for (const path of [
      "src/components/ui/Dialog.tsx",
      "src/components/ui/Menu.tsx",
    ]) {
      const contents = source(path);
      expect(contents, `${path} has no enter animation`).toContain(
        'data-[state=open]:animate-'
      );
      expect(contents, `${path} has no exit animation`).toContain(
        'data-[state=closed]:animate-'
      );
    }
  });

  it("keeps the sheet gesture physics intact", () => {
    const sheet = source("src/components/ui/Sheet.tsx");
    // 1:1 tracking that survives the pointer leaving the element.
    expect(sheet).toContain("setPointerCapture");
    // Land where the flick was aimed, not where the finger lifted.
    expect(sheet).toContain("projectMomentum");
    // Resist progressively at the boundary instead of stopping dead.
    expect(sheet).toContain("rubberband");
    // Hand the release velocity to the spring so there is no seam.
    expect(sheet).toContain("velocity");
  });
});

describe("platform hygiene", () => {
  const sourceFiles = [...walk("src", [".tsx", ".ts"])].filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")
  );

  it("uses dynamic viewport units rather than 100vh for full-height layout", () => {
    // `100vh` exceeds the visible viewport on mobile browsers, pushing
    // bottom-anchored controls under the URL bar.
    const offenders = sourceFiles.filter((file) => {
      const contents = source(file);
      return contents.includes("min-h-screen") || contents.includes("100vh");
    });
    expect(offenders).toEqual([]);
  });

  it("ships no remote webfonts", () => {
    // The renderer rule and the perf contract both require self-hosted fonts.
    const offenders = sourceFiles.filter((file) =>
      source(file).includes("next/font/google")
    );
    expect(offenders).toEqual([]);
  });

  it("declares viewport-fit and a theme colour so safe areas resolve", () => {
    const layout = source("src/app/layout.tsx");
    expect(layout).toContain("viewportFit");
    expect(layout).toContain("themeColor");
  });

  it("keeps designed boundaries for the error and missing-page states", () => {
    expect(() => source("src/app/not-found.tsx")).not.toThrow();
    expect(() => source("src/app/error.tsx")).not.toThrow();
  });
});
