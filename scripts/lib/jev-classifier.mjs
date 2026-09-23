// Registry classification with TypeSafe's Jev (System One model).
//
// One Choice question per organisation over the map's care categories plus
// "association" (everything that is not a care/aid provider). Jev returns a
// calibrated probability per option; the answer's confidence decides whether
// the category may be auto-published or needs review. The rubric below was
// written against a hand-labelled sample (see docs/REGISTRY_CLASSIFICATION.md);
// change it only together with a re-run of `npm run registry:classify -- --eval`.
//
// The registry text is Croatian. Criteria are English with the Croatian terms
// the registry actually uses, because Jev's accuracy is best in English.

import { AUTO_PUBLISH_EXCLUSIONS, inferAcceptsDonations, normalize } from "./category-rules.mjs";

export const JEV_MODEL = process.env.TYPESAFE_MODEL || "jev-1.13.0";
export const JEV_CLASSIFICATION_VERSION = "jev-1.13.0/2026-09-23.1";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** Field lengths sent to Jev; long statutes add noise, not signal. */
const LIMITS = { name: 300, goals: 700, activities: 500, groups: 400 };

export const CATEGORY_CRITERIA = {
  association:
    "NOT a care or aid provider. Sports clubs and federations, hunting, fishing, mountaineering, " +
    "firefighters (DVD, vatrogasci), scouts, culture, folklore (KUD), music, theatre, art, hobby, " +
    "technical and gaming clubs, tourism, local development (LAG), environment and nature, " +
    "animal protection and animal shelters (azil za životinje), professional and business " +
    "associations (including associations of psychotherapists, nurses, social workers), science, " +
    "education, student and youth clubs, religious communities (unless their activities are mainly " +
    "distributing aid to people in need), national minorities, homeland clubs, human rights " +
    "and advocacy, war veterans' associations (branitelji, dragovoljci) that are not organisations " +
    "of war invalids or of veterans treated for PTSD, Rotary and Lions clubs, health promotion or diet clubs.",
  homeless_shelter:
    "Helps homeless people (beskućnici): shelters, night shelters (prenoćište, prihvatilište), " +
    "day centres, networks and advocacy for homeless people.",
  soup_kitchen:
    "Mainly prepares or hands out food to people in need: soup kitchen (pučka kuhinja), food bank " +
    "(banka hrane), social supermarket (socijalna samoposluga).",
  children_home:
    "Children without adequate parental care (djeca bez odgovarajuće roditeljske skrbi): children's " +
    "homes, SOS children's villages, foster care (udomiteljstvo, udomitelji) and adoption (posvojenje).",
  caritas: "Caritas or another church-run charity service (Caritas, karitativna služba župe).",
  disability_support:
    "Organisations of or for persons with disabilities (osobe s invaliditetom), including deaf, blind, " +
    "deafblind, autism, Down syndrome, cerebral palsy, intellectual disability, children with " +
    "developmental difficulties (djeca s teškoćama u razvoju), war invalids (HVIDR, invalidi " +
    "Domovinskog rata), therapeutic riding, and sports clubs whose members are persons with disabilities.",
  domestic_violence:
    "Support for victims of violence: domestic and partner violence, safe houses (sigurna kuća), " +
    "shelters and counselling for women and children who survived violence, victim and witness support.",
  elderly_care:
    "Older people and pensioners: pensioners' associations (udruga umirovljenika, matica umirovljenika) " +
    "that protect pensioners' rights and welfare, home help and care for elderly and frail people, " +
    "foster care for elderly people.",
  social_welfare:
    "General humanitarian and social aid for people in need: Red Cross societies (Crveni križ), " +
    "humanitarian associations collecting and distributing aid, support for poor and socially " +
    "excluded families, psychosocial support services, resocialisation of former prisoners.",
  student_housing: "Student dormitories or student accommodation (studentski dom, studentski smještaj).",
  mental_health:
    "Mental health and addiction: clubs of treated alcoholics (KLA), addiction prevention and " +
    "treatment, therapeutic communities, psychological counselling and psychotherapy services for " +
    "people, support for people with mental illness, PTSD support, grief and crisis support.",
  refugee_migrant_support:
    "Refugees, asylum seekers, migrants and displaced persons (izbjeglice, prognanici, azilanti): " +
    "integration, legal help, housing and humanitarian help for them.",
  medical_patient_support:
    "Patients and people with a specific illness: patient associations (diabetes, cancer, multiple " +
    "sclerosis, cystic fibrosis, HIV, stroke, rare diseases), leagues against cancer, and voluntary " +
    "blood donor clubs (darivatelji krvi).",
};

export const CATEGORIES = Object.keys(CATEGORY_CRITERIA);

const INSTRUCTIONS =
  "What is this Croatian civil society organisation's main purpose? Decide from its `name`, " +
  "`goals` and `activities`. `target_groups` is a list the organisation ticked in the registry and " +
  "is often far too broad: use it only as a weak hint, never as the deciding reason. Choose a care " +
  "category only if providing that care or support is what the organisation mainly does; otherwise " +
  "choose `association`. Words in the name alone do not decide (a theatre group called " +
  "\"Beskućnici\" is still a theatre).";

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** @param {{naziv?: string, ciljevi?: string, opis_djelatnosti?: string, ciljane_skupine?: string}} row */
export function jevState(row) {
  return {
    name: clip(row.naziv, LIMITS.name),
    goals: clip(row.ciljevi, LIMITS.goals) || "(not stated)",
    activities: clip(row.opis_djelatnosti, LIMITS.activities) || "(not stated)",
    target_groups: clip(row.ciljane_skupine, LIMITS.groups) || "(not stated)",
  };
}

export function jevQuestions() {
  return {
    category: { type: "choice", instructions: INSTRUCTIONS, criteria: CATEGORY_CRITERIA },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One evaluation, retried with backoff on 429/529/5xx and network errors.
 * Returns { choice, probabilities, confidence, model, inputTokens }.
 */
export async function classifyWithJev(row, { apiKey = process.env.TYPESAFE_API_KEY, attempts = 6 } = {}) {
  if (!apiKey) throw new Error("Missing TYPESAFE_API_KEY");
  const body = JSON.stringify({ model: JEV_MODEL, state: jevState(row), questions: jevQuestions() });
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const json = await response.json();
        const answer = json.answers?.category;
        if (answer?.type !== "choice" || !CATEGORIES.includes(answer.choice)) {
          throw new Error(`Unexpected Jev answer: ${JSON.stringify(json).slice(0, 200)}`);
        }
        return {
          choice: answer.choice,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
          model: json.model,
          inputTokens: json.usage?.input_tokens ?? 0,
        };
      }
      const retryable = response.status === 429 || response.status >= 500;
      const text = await response.text().catch(() => "");
      lastError = new Error(`Jev HTTP ${response.status}: ${text.slice(0, 200)}`);
      if (!retryable) throw lastError;
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (String(error?.message).startsWith("Jev HTTP 4") && !String(error.message).includes("429")) throw error;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Bounded-concurrency map that keeps input order. */
export async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** Version the importer stamps on rows that still need a Jev classification. */
export const PENDING_CLASSIFICATION_VERSION = "pending:jev";

/** A care category is auto-published only at or above this confidence (tuned on the sample). */
export const AUTO_PUBLISH_CONFIDENCE = 0.6;
/** Below this, an "association" answer that still leaves room for a care category goes to review. */
export const ASSOCIATION_REVIEW_CONFIDENCE = 0.5;

/** Turn one Jev answer into the classification columns apply_registry_classifications takes. */
export function toClassification(row, answer) {
  const ranked = Object.entries(answer.probabilities)
    .filter(([category]) => CATEGORIES.includes(category))
    .sort((a, b) => b[1] - a[1]);
  const candidates = ranked.slice(0, 3).map(([category, probability]) => ({
    category,
    probability: Number(probability.toFixed(4)),
  }));
  const confidence = Number(answer.confidence.toFixed(4));
  const base = {
    udr_id: row.udr_id,
    mapped_confidence: confidence,
    mapped_rule: `jev:${answer.model}`,
    classification_candidates: candidates,
    classification_version: JEV_CLASSIFICATION_VERSION,
  };
  const activityText = `${row.opis_djelatnosti || ""}\n${row.ciljevi || ""}\n${row.ciljane_skupine || ""}`;

  if (answer.choice === "association") {
    const topCare = ranked.find(([category]) => category !== "association");
    const uncertain = confidence < ASSOCIATION_REVIEW_CONFIDENCE && topCare;
    return {
      ...base,
      mapped_category: null,
      classification_status: uncertain ? "needs_review" : "unmapped",
      classification_reasons: uncertain
        ? [`jev: not clearly a care provider; closest care category ${topCare[0]}`]
        : ["jev: not a care or aid provider"],
      donation_candidates: [],
    };
  }

  // Invariant: excluded entity shapes (sports/culture/hobby names) always need
  // a human, whatever the model says.
  const name = normalize(row.naziv || "");
  const excluded = AUTO_PUBLISH_EXCLUSIONS.some((pattern) => pattern.test(name));
  const reasons = [];
  if (excluded) reasons.push("excluded entity type requires human review");
  if (confidence < AUTO_PUBLISH_CONFIDENCE) reasons.push("jev confidence below auto-publish threshold");
  return {
    ...base,
    mapped_category: answer.choice,
    classification_status: reasons.length ? "needs_review" : "auto_eligible",
    classification_reasons: reasons.length ? reasons : [`jev: ${answer.choice}`],
    donation_candidates: inferAcceptsDonations(answer.choice, activityText),
  };
}

