import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dictionaries, resolveKey } from "@/i18n/dictionaries";
import { TourIllustration, type SceneName } from "./illustrations";
import { layoutTour } from "./tour-layout";
import { AUTO_START_PATHS, buildTourSteps, isOnStepPath, type TourStep } from "./tour-steps";

const ANONYMOUS = { signedIn: false } as const;

function allSteps(): TourStep[] {
  return [
    ...buildTourSteps("individual", ANONYMOUS),
    ...buildTourSteps("ngo", ANONYMOUS),
    ...buildTourSteps("individual", { signedIn: true, role: "individual" }),
    ...buildTourSteps("individual", { signedIn: true, role: "ngo" }),
  ];
}

describe("tour sequence", () => {
  it("shows an anonymous visitor how to sign in before what they can do", () => {
    const individual = buildTourSteps("individual", ANONYMOUS).map((step) => step.id);
    expect(individual[0]).toBe("intro");
    expect(individual.slice(1, 4)).toEqual(["sign-in-button", "login-form", "login-google"]);
    expect(individual.indexOf("register-role")).toBeLessThan(individual.indexOf("map-search"));
    expect(individual.at(-1)).toBe("done");

    const ngo = buildTourSteps("ngo", ANONYMOUS).map((step) => step.id);
    expect(ngo[1]).toBe("register-ngo-button");
    expect(ngo).toContain("claim");
    expect(ngo).toContain("login-existing");
    expect(ngo.indexOf("claim-verify")).toBeLessThan(ngo.indexOf("ngo-needs"));
  });

  it("gives each track its own feature overview", () => {
    const individual = buildTourSteps("individual", ANONYMOUS).map((step) => step.id);
    const ngo = buildTourSteps("ngo", ANONYMOUS).map((step) => step.id);
    expect(individual).toContain("donate-pledge");
    expect(individual).not.toContain("ngo-needs");
    expect(ngo).toContain("ngo-pledges");
    expect(ngo).not.toContain("donate-pledge");
  });

  it("skips the sign-in part for a signed-in account and follows its real role", () => {
    const ids = buildTourSteps("individual", { signedIn: true, role: "ngo" }).map((step) => step.id);
    expect(ids).not.toContain("sign-in-button");
    expect(ids).not.toContain("register-role");
    expect(ids).toContain("ngo-needs");
  });

  it("never points an anonymous visitor at a control only accounts have", () => {
    for (const track of ["individual", "ngo"] as const) {
      for (const step of buildTourSteps(track, ANONYMOUS)) {
        for (const target of step.targets ?? []) {
          expect(target, step.id).not.toMatch(/^nav-(bell|profile|ngo-)/);
        }
      }
    }
    const signedIn = buildTourSteps("ngo", { signedIn: true, role: "ngo" });
    expect(signedIn.find((step) => step.id === "ngo-pledges")?.targets).toEqual(["nav-ngo-pledges", "nav-menu"]);
    expect(signedIn.find((step) => step.id === "notifications")?.targets).toEqual(["nav-bell"]);
  });

  it("has a title and body in both languages for every card", () => {
    const keys = new Set(allSteps().map((step) => step.copy));
    keys.add("intro_signed_in");
    keys.add("done_signed_in");
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of keys) {
        for (const suffix of ["title", "body"]) {
          const path = `tour.steps.${key}_${suffix}`;
          expect(resolveKey(dictionary, path), `${locale}: ${path}`).not.toBe(path);
        }
      }
    }
  });

  it("only opens by itself on public pages", () => {
    expect(AUTO_START_PATHS).toContain("/");
    for (const path of AUTO_START_PATHS) {
      expect(path.startsWith("/auth") || path.startsWith("/dashboard"), path).toBe(false);
    }
  });
});

describe("isOnStepPath", () => {
  const step = (path?: string): TourStep => ({ id: "x", scene: "welcome", copy: "intro", path });

  it("ignores extra state the page adds to its own URL", () => {
    expect(isOnStepPath(step("/"), "/", "%40=45.1%2C16.3%2C7")).toBe(true);
    expect(isOnStepPath(step(), "/anything", "")).toBe(true);
  });

  it("tells the register role tiles from the association form", () => {
    expect(isOnStepPath(step("/auth/register"), "/auth/register", "")).toBe(true);
    expect(isOnStepPath(step("/auth/register"), "/auth/register", "role=ngo")).toBe(false);
    expect(isOnStepPath(step("/auth/register?role=ngo"), "/auth/register", "role=ngo")).toBe(true);
    expect(isOnStepPath(step("/auth/register?role=ngo"), "/auth/register", "")).toBe(false);
  });
});

function walk(dir: string): string[] {
  return readdirSync(resolve(process.cwd(), dir)).flatMap((entry) => {
    const rel = join(dir, entry);
    if (statSync(resolve(process.cwd(), rel)).isDirectory()) return walk(rel);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [rel] : [];
  });
}

describe("tour hooks", () => {
  it("finds every data-tour name the steps point at somewhere in the app", () => {
    const source = walk("src").map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
    const names = new Set(allSteps().flatMap((step) => step.targets ?? []));
    for (const name of names) {
      // `donate-view-${candidate}` is built from the view list.
      const dynamic = name.startsWith("donate-view-") && source.includes("data-tour={`donate-view-${candidate}`}");
      const literal = source.includes(`data-tour="${name}"`) || source.includes(`tourId: "${name}"`) || source.includes(`tourId="${name}"`);
      expect(dynamic || literal, `no element carries data-tour="${name}"`).toBe(true);
    }
  });
});

describe("tour layout", () => {
  const desktop = { width: 1400, height: 1000 };
  const phone = { width: 375, height: 812 };
  const card = { width: 384, height: 420 };

  it("centres the card when there is nothing to point at", () => {
    const layout = layoutTour(desktop, null, card);
    expect(layout.placement).toBe("center");
    expect(layout.spot).toBeNull();
    expect(layout.arrow).toBeNull();
    expect(layout.card.x).toBe((1400 - 384) / 2);
  });

  it("puts the card below a control near the top and draws an arrow up to it", () => {
    const layout = layoutTour(desktop, { left: 600, top: 80, width: 200, height: 40 }, card);
    expect(layout.placement).toBe("bottom");
    expect(layout.arrow).not.toBeNull();
    expect(layout.arrow!.to.y).toBeLessThan(layout.arrow!.from.y);
  });

  it("keeps the card inside the viewport beside a control in the corner", () => {
    const layout = layoutTour(desktop, { left: 1290, top: 12, width: 90, height: 40 }, card);
    expect(layout.card.x + layout.cardWidth).toBeLessThanOrEqual(desktop.width - 16);
    expect(layout.card.x).toBeGreaterThanOrEqual(16);
  });

  it("docks on a phone to the edge that leaves the control visible", () => {
    const high = layoutTour(phone, { left: 20, top: 322, width: 335, height: 44 }, { width: 343, height: 389 });
    expect(high.placement).toBe("dock-bottom");
    expect(high.card.y).toBeGreaterThan(322 + 44);

    const low = layoutTour(phone, { left: 20, top: 640, width: 335, height: 44 }, { width: 343, height: 389 });
    expect(low.placement).toBe("dock-top");
    expect(low.card.y + 389).toBeLessThan(640);
  });

  it("drops the arrow rather than draw it through a card lying over the control", () => {
    const layout = layoutTour(phone, { left: 0, top: 56, width: 375, height: 756 }, { width: 343, height: 389 });
    expect(layout.arrow).toBeNull();
    expect(layout.spot).not.toBeNull();
  });
});

describe("tour illustrations", () => {
  const scenes = new Set<SceneName>(allSteps().map((step) => step.scene));

  it("draws every scene the steps use as a finite, self-contained SVG", () => {
    for (const scene of scenes) {
      const markup = renderToStaticMarkup(createElement(TourIllustration, { scene }));
      expect(markup, scene).toMatch(/^<svg viewBox="0 0 320 190"/);
      expect(markup, scene).not.toMatch(/NaN|undefined|Infinity/);
      expect(markup, scene).not.toMatch(/<image|href="http/);
    }
  });
});
