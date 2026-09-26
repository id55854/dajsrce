import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { richText } from "./rich-text";

function html(node: ReturnType<typeof richText>) {
  return renderToStaticMarkup(createElement(Fragment, null, node));
}

describe("richText", () => {
  it("puts nodes where the translation places them", () => {
    const out = html(
      richText("Prihvaćam {terms}. Pročitao/la sam {privacy}.", {
        terms: createElement("a", { href: "/uvjeti-koristenja" }, "Uvjete korištenja"),
        privacy: createElement("a", { href: "/pravila-privatnosti" }, "Pravila privatnosti"),
      })
    );
    expect(out).toBe(
      'Prihvaćam <a href="/uvjeti-koristenja">Uvjete korištenja</a>. Pročitao/la sam <a href="/pravila-privatnosti">Pravila privatnosti</a>.'
    );
  });

  it("leaves unknown placeholders and plain text alone", () => {
    expect(html(richText("Više u {privacy} i {other}.", { privacy: "pravilima" }))).toBe(
      "Više u pravilima i {other}."
    );
    expect(html(richText("Bez poveznica.", {}))).toBe("Bez poveznica.");
  });

  it("escapes the surrounding text like any other React text", () => {
    expect(html(richText("<b>{x}</b>", { x: "ok" }))).toBe("&lt;b&gt;ok&lt;/b&gt;");
  });
});
