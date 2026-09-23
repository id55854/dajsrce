# Registry classification (Jev)

**Adopted:** 2026-09-23. Replaces the keyword rules in `scripts/lib/category-rules.mjs` as the source of published categories.

## Why the rules were replaced

The official register lists about 43,000 active associations. The map's default filter shows only the care categories, so a wrong category puts a sports club on the map as a disability service and hides a real one. The rules scored mostly on `ciljane_skupine`, the target-group tick list, which most organisations fill far too broadly. A microscopy society, a radio-amateur federation and a local action group were all published as care providers.

Measured on the hand-labelled sample (below), the organisations the rules published under a care category were right **42.9%** of the time, and they found **31.8%** of the real care organisations.

## How it works now

`scripts/lib/jev-classifier.mjs` sends TypeSafe's Jev (`jev-1.13.0`, pinned) one Choice question per organisation:

- **State:** name, goals (`ciljevi`), activities (`opis_djelatnosti`) and target groups, each clipped (700/500/400 chars). The instructions tell Jev to treat target groups as a weak hint only.
- **Options:** the 12 care categories plus `association` (not a care or aid provider). Each option has an English rubric with the Croatian terms the register uses, plus boundary cases (for example: veterans' clubs are `association` unless they are war-invalid or PTSD organisations; animal "azil" is `association`; clubs of treated alcoholics are `mental_health`; blood donor clubs are `medical_patient_support`).
- **Gate** (`toClassification`):
  - A care answer with confidence ≥ **0.6** is `auto_eligible`, and only `auto_eligible` is shown on the map.
  - A care answer below that is `needs_review`, and so is any name matching `AUTO_PUBLISH_EXCLUSIONS` (invariant 8).
  - An `association` answer with confidence < 0.5 goes to review, with the closest care category noted. Otherwise it is `unmapped`.
- **Write:** `apply_registry_classifications` updates `ngo_registry` and, in the same transaction, the current snapshot's `registry_directory_entries.category`. Curated institutions still win.
- **Sync:** `merge_registry_import_batch` keeps a Jev classification while name, goals, activities and target groups are unchanged. The importer stamps new or changed rows `pending:jev` / `unmapped`, so rule guesses are never published. The rule output is kept only as a reference candidate. `registry-sync.yml` runs `npm run registry:classify` after every sync; it sends only rows not on the current `JEV_CLASSIFICATION_VERSION`.

Cost: about 1,600 input tokens per organisation. A full pass is about 69M tokens, roughly $3 at $0.042/Mtok, and takes about 35 minutes at concurrency 16.

## Evaluation

`data/registry-classification-gold.json` holds 416 organisations labelled by hand on 2026-09-23 by reading each one's name, goals and activities:

- 200 drawn at random from the active register;
- 216 drawn to cover every care category: the rules' own picks per category, and name keywords per category.

Labels follow the rubric above: a care category only when providing that care is the organisation's main purpose. The sample was split, stratified by label, into dev (210) and test (206). Rubric wording was tuned on dev only; test was scored once.

| Held-out test (n=206) | Rules | Jev (as published) |
| --- | --- | --- |
| Care precision | 42.9% | 95.3% |
| Care recall | 31.8% | 92.4% |
| Accuracy | 72.3% | 96.6% |

The remaining errors are borderline cases such as foster care for adults, sports clubs for MS patients, and professional psychotherapy societies. Caritas and student-dorm entities are not registered associations, so those two categories are effectively empty in the register.

## Changing the rubric

1. Edit `CATEGORY_CRITERIA` or `INSTRUCTIONS` in `scripts/lib/jev-classifier.mjs`.
2. Bump `JEV_CLASSIFICATION_VERSION`.
3. Run `npm run registry:classify -- --eval` and compare against the table above. Do not ship a drop in test precision.
4. Run `npm run registry:classify` to reclassify every row on an older version.

To add hand labels, append to the gold file with `split` chosen by the same stratified rule, and never tune on `test`.
