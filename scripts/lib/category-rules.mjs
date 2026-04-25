// Category mapping rules for RegistarUdruga.csv → DajSrce InstitutionCategory.
//
// Inputs come from two CSV columns:
//   * CILJANE_SKUPINE — comma-separated tags ("OSOBE S INVALIDITETOM, …")
//   * OPIS_DJELATNOSTI / CILJEVI — long Croatian prose
//
// Each rule contributes evidence; the category with the highest weighted score
// wins.  We also assign a confidence in [0, 1] used by the promoter to gate
// what lands on the public map.
//
// Rule format:
//   { category, weight, source: "groups"|"text", pattern: RegExp, label }
//
// Patterns are case-insensitive; Croatian diacritic-insensitive matching is
// achieved by stripping diacritics before testing.

export const RULES = [
  // -------------------- homeless_shelter --------------------
  { category: "homeless_shelter", source: "groups", weight: 5, pattern: /\bBESKUCNIC|BESKUCNIK\b/i, label: "ciljana skupina: beskućnici" },
  { category: "homeless_shelter", source: "text",   weight: 3, pattern: /prihvatiliste za beskucnike|nocni smjestaj|prenociste/i, label: "opis: prihvatilište" },

  // -------------------- soup_kitchen --------------------
  // Only match when the entity IS a soup kitchen, not when it merely
  // mentions one. The naziv test is the strong signal; the opis test
  // requires the phrase to be very early (first 200 chars) to filter out
  // tangential mentions.
  { category: "soup_kitchen", source: "name", weight: 6, pattern: /\b(pucka kuhinja|banka hrane|socijalna samoposluga)\b/i, label: "naziv: pučka kuhinja / banka hrane" },
  { category: "soup_kitchen", source: "text", weight: 3, pattern: /^.{0,200}(pucka kuhinja|banka hrane|socijalna samoposluga)/is, label: "opis (rano): pučka kuhinja / banka hrane" },

  // -------------------- children_home --------------------
  { category: "children_home", source: "groups", weight: 5, pattern: /DJECA BEZ ODGOVARAJUCE RODITELJSKE SKRBI/i, label: "ciljana skupina: djeca bez roditeljske skrbi" },
  { category: "children_home", source: "groups", weight: 3, pattern: /UDOMITELJ/i, label: "ciljana skupina: udomitelji" },
  { category: "children_home", source: "text",   weight: 4, pattern: /dom za djecu|udomiteljstvo|napustena djeca|napusteni mladi/i, label: "opis: dom za djecu / udomiteljstvo" },

  // -------------------- caritas --------------------
  // Caritas is operator-shaped; only match the literal word "Caritas" in
  // the name. "Župa" is a place name in Croatia (Župa dubrovačka, etc.) and
  // also appears in unrelated NGOs ("Lovačko društvo Župa") — too noisy.
  { category: "caritas", source: "name", weight: 6, pattern: /\bcaritas\b/i, label: "naziv: Caritas" },

  // -------------------- disability_support --------------------
  { category: "disability_support", source: "groups", weight: 5, pattern: /OSOBE S INVALIDITETOM|TJELESNIM INVALIDITETOM|INTELEKTUALNIM TESKOCAMA|MENTALNIM OSTECENJEM/i, label: "ciljana skupina: invaliditet" },
  { category: "disability_support", source: "groups", weight: 4, pattern: /\bGLUH|\bSLIJEPI|AUTIZ/i, label: "ciljana skupina: gluhi/slijepi/autizam" },
  { category: "disability_support", source: "text",   weight: 3, pattern: /dnevni boravak.*invalid|stambena zajednica.*invalid|inkluzij/i, label: "opis: dnevni boravak / inkluzija" },

  // -------------------- domestic_violence --------------------
  { category: "domestic_violence", source: "groups", weight: 5, pattern: /ZRTVE NASILJA|NASILJA U OBITELJI|OBITELJSKOG NASILJA|NASILJA NAD ZENAMA|ZLOSTAVLJANJ/i, label: "ciljana skupina: žrtve nasilja" },
  { category: "domestic_violence", source: "text",   weight: 4, pattern: /sigurna kuca|sklonist[ae] za zene|savjetovaliste za zrtv/i, label: "opis: sigurna kuća" },

  // -------------------- elderly_care --------------------
  { category: "elderly_care", source: "groups", weight: 4, pattern: /OSOBE STARIJE ZIVOTNE DOBI/i, label: "ciljana skupina: starije osobe" },
  { category: "elderly_care", source: "groups", weight: 2, pattern: /UMIROVLJENIC/i, label: "ciljana skupina: umirovljenici" },
  { category: "elderly_care", source: "text",   weight: 3, pattern: /pomoc u kuci|gerontolog|dom za starije/i, label: "opis: pomoć u kući / gerontologija" },

  // -------------------- social_welfare --------------------
  { category: "social_welfare", source: "groups", weight: 4, pattern: /\bSIROMASN|KORISNICI ZAJAMCENE MINIMALNE NAKNADE|OBITELJI U RIZIKU/i, label: "ciljana skupina: siromaštvo" },
  { category: "social_welfare", source: "text",   weight: 2, pattern: /humanitarn|socijalna pomoc|materijaln[ao] pomoc/i, label: "opis: humanitarno / socijalna pomoć" },

  // -------------------- student_housing --------------------
  // Tight: "studentski dom" / "studentski smjestaj" only. "Stipendiranj"
  // also fires for sports / academic scholarships.
  { category: "student_housing", source: "name", weight: 6, pattern: /\bstudentski dom\b|\bstudentski smjestaj\b/i, label: "naziv: studentski dom" },
  { category: "student_housing", source: "text", weight: 3, pattern: /\bstudentski dom\b|\bstudentski smjestaj\b/i, label: "opis: studentski dom" },

  // -------------------- mental_health --------------------
  // Actual data uses "OVISNICI I LIJEČENI OVISNICI" and "OSOBE S MENTALNOM
  // RETARDACIJOM" — broader patterns required.
  { category: "mental_health", source: "groups", weight: 5, pattern: /\bOVISNIC[IA]?\b|LIJECENI OVISNIC|OSOBE S MENTALNOM|MENTALNI POREMEC|PSIHIJATR/i, label: "ciljana skupina: ovisnici / mentalno zdravlje" },
  { category: "mental_health", source: "text",   weight: 4, pattern: /terapijska zajednica|apstinent|mentalno zdravlje|prevencija ovisnosti|liječeni ovisnici/i, label: "opis: terapijska zajednica" },

  // -------------------- refugee_migrant_support --------------------
  { category: "refugee_migrant_support", source: "groups", weight: 5, pattern: /IZBJEGLIC|TRAZITELJI AZILA|MIGRANT/i, label: "ciljana skupina: izbjeglice/migranti" },
  { category: "refugee_migrant_support", source: "text",   weight: 4, pattern: /pravna pomoc trazitelj|integracija migrant|prihvat izbjeglica/i, label: "opis: pravna pomoć tražiteljima azila" },

  // -------------------- medical_patient_support --------------------
  { category: "medical_patient_support", source: "text",   weight: 5, pattern: /udruga oboljeli[hh]?|udruga pacijenat|udruga bolesnik|dijabetic|multipla skleroza|cisticna fibroza|epilepsi|onkolog|liga protiv raka|bolesnici od/i, label: "opis: udruga oboljelih / pacijenata" },
  { category: "medical_patient_support", source: "groups", weight: 5, pattern: /\bOBOLJEL|\bPACIJENT|\bBOLESNIC|POPULACIJA PACIJENATA/i, label: "ciljana skupina: oboljeli/pacijenti" },
  { category: "medical_patient_support", source: "name",   weight: 4, pattern: /\b(udruga|liga|drustvo) (oboljelih?|pacijenata|dijabetica|onkolosk)/i, label: "naziv: udruga oboljelih" },

  // -------------------- negative signals --------------------
  // These don't pick a category; they DOWN-weight social-impact matches
  // when the row is clearly sports/cultural/professional.
  // Applied in scoreRow().
];

export const NEGATIVE_SIGNALS = [
  { source: "groups", pattern: /\bSPORTAS\b|\bSPORTSKI DJELATNICI\b|\bAKADEMSKA ZAJEDNICA\b/i, penalty: 3 },
  { source: "name",   pattern: /\bsportski klub\b|\bnogometni klub\b|\bkosarkaski klub\b|\brukometni klub\b|\bsah\b|\bplesni klub\b/i, penalty: 4 },
  { source: "name",   pattern: /\blovacka udruga\b|\bribolovni\b|\bplaninarski\b|\bautoklub\b/i, penalty: 4 },
];

// Diacritic-insensitive normalisation. Strips ČĆŽŠĐ → CCZSDj for matching.
export function normalize(s) {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\bDj\b/g, "DJ")
    .replace(/dj/gi, (m) => (m === "DJ" ? "DJ" : "dj"))
    .toLowerCase();
}

/**
 * @param {{groups: string, text: string, name: string}} row
 * @returns {{category: string|null, confidence: number, rule: string|null, scores: Object}}
 */
export function scoreRow(row) {
  const groups = normalize(row.groups || "");
  const text = normalize(row.text || "");
  const name = normalize(row.name || "");

  const scores = {};
  const ruleHits = {};

  for (const r of RULES) {
    const hay = r.source === "groups" ? groups : r.source === "name" ? name : text;
    if (r.pattern.test(hay)) {
      scores[r.category] = (scores[r.category] || 0) + r.weight;
      ruleHits[r.category] = (ruleHits[r.category] || []);
      ruleHits[r.category].push(r.label);
    }
  }

  let penalty = 0;
  for (const n of NEGATIVE_SIGNALS) {
    const hay = n.source === "groups" ? groups : name;
    if (n.pattern.test(hay)) penalty += n.penalty;
  }

  // Pick best category. When a more-specific category has a strong signal,
  // prefer it over a generic one with the same score. (Examples: cancer
  // patient association whose members happen to be elderly.)
  const SPECIFICITY = {
    medical_patient_support: 4,
    mental_health: 4,
    refugee_migrant_support: 4,
    homeless_shelter: 4,
    domestic_violence: 4,
    children_home: 3,
    disability_support: 3,
    soup_kitchen: 3,
    student_housing: 3,
    caritas: 2,
    elderly_care: 2,
    social_welfare: 1,
  };
  const entries = Object.entries(scores).map(([k, v]) => [k, v, SPECIFICITY[k] ?? 0]);
  if (entries.length === 0) {
    return { category: null, confidence: 0, rule: null, scores: {} };
  }
  // Sort by score desc, then specificity desc.
  entries.sort((a, b) => (b[1] - a[1]) || (b[2] - a[2]));
  const [bestCat, bestScore] = entries[0];
  const adjScore = Math.max(0, bestScore - penalty);
  if (adjScore <= 0) {
    return { category: null, confidence: 0, rule: "outweighed by negative signals", scores };
  }

  // Confidence: 0.95 for ≥8, 0.7 for ≥5, 0.45 for ≥3, 0.25 below.
  let confidence;
  if (adjScore >= 8) confidence = 0.95;
  else if (adjScore >= 5) confidence = 0.7;
  else if (adjScore >= 3) confidence = 0.45;
  else confidence = 0.25;

  // Margin: if the second-best is close AND not on a less-specific category,
  // drop confidence one tier. (When specificity already disambiguated, the
  // tie isn't meaningful.)
  if (entries.length > 1) {
    const [, secondScore, secondSpec] = entries[1];
    const bestSpec = entries[0][2];
    if (bestScore - secondScore <= 1 && bestSpec === secondSpec) {
      confidence = Math.max(0.25, confidence - 0.2);
    }
  }

  return {
    category: bestCat,
    confidence: Number(confidence.toFixed(3)),
    rule: (ruleHits[bestCat] || []).join(" + ") || null,
    scores,
  };
}

/**
 * Parse SJEDISTE ("Avenija Marina Držića 1, Zagreb") → { street, city }.
 */
export function parseSjediste(s) {
  if (!s) return { street: null, city: null };
  const idx = s.lastIndexOf(",");
  if (idx === -1) return { street: s.trim(), city: null };
  return {
    street: s.slice(0, idx).trim() || null,
    city: s.slice(idx + 1).trim() || null,
  };
}

/**
 * Derive served_population from CILJANE_SKUPINE — keep human-readable.
 * Returns up to 3 most informative tags joined.
 */
export function derivedServedPopulation(groups) {
  if (!groups) return null;
  const tokens = groups
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Prefer specific groups over generic ones.
  const generic = new Set([
    "GRAĐANI – OPĆA POPULACIJA",
    "GRAĐANI - OPĆA POPULACIJA",
    "MLADI - OPĆA POPULACIJA",
    "DJECA - OPĆA POPULACIJA",
    "OSTALI",
  ]);
  const specific = tokens.filter((t) => !generic.has(t));
  const ordered = specific.length > 0 ? specific : tokens;
  return ordered.slice(0, 3).join(", ") || null;
}

/**
 * Best-effort accepts_donations inference from a row.
 * Conservative — empty when uncertain. NGOs refine on claim.
 */
export function inferAcceptsDonations(category, text) {
  const t = normalize(text);
  const hits = new Set();
  if (/hrana|topli obrok|namirnic|prehrana/.test(t)) hits.add("food");
  if (/odjec|obuc|tekstil/.test(t)) hits.add("clothes");
  if (/higijensk|sapun|pelene/.test(t)) hits.add("hygiene");
  if (/igracke|knjige|skolski pribor/.test(t)) hits.add("toys_books");
  if (/medicinsk|lijek|pomagalo|invalidska kolica/.test(t)) hits.add("medical_supplies");
  if (/beba|bebe|dojenc|trudnic/.test(t)) hits.add("baby_items");
  if (/posteljin|deke|krevet/.test(t)) hits.add("blankets_bedding");
  if (/donacij|novcan/.test(t)) hits.add("money");
  if (/volonter/.test(t)) hits.add("time");

  // category-derived defaults
  if (category === "soup_kitchen") { hits.add("food"); hits.add("hygiene"); }
  if (category === "homeless_shelter") { hits.add("clothes"); hits.add("hygiene"); hits.add("blankets_bedding"); }
  if (category === "domestic_violence") { hits.add("hygiene"); hits.add("clothes"); }
  if (category === "children_home") { hits.add("clothes"); hits.add("toys_books"); hits.add("school_supplies"); }
  if (category === "elderly_care") { hits.add("hygiene"); hits.add("medical_supplies"); }
  if (category === "disability_support") { hits.add("medical_supplies"); }

  return Array.from(hits);
}
