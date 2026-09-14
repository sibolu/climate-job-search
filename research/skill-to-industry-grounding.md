# Grounding "where does this skill land in climate?" in open labour-market data

Status: research only. No code, no schema, no PLAN.md step yet. Written
2026-09-14 on branch `claude/elegant-shannon-ggeqnm`.

Verification caveat, stated up front because it limits how far this document
should be trusted: this session's egress policy blocked direct HTTPS to
`onetcenter.org`, `onetonline.org`, `bls.gov`, `energy.gov`, `esco.ec.europa.eu`
and `lightcast.io` (403 at the gateway on CONNECT). Everything below comes from
search-result summaries of those pages plus prior knowledge. Exact file names,
column lists, row counts, API quotas and licence wording are marked
**[verify]** where an implementation would depend on them.
`deep-research-prompt.md` in this folder is the prompt to close those gaps.

---

## 1. The feature

Today `ProfileTab.tsx` renders `profile.skills.confirmed` and
`profile.skills.inferred` as flat text lists (`src/components/ProfileTab.tsx:125`
and `:141`). The proposal is to make a confirmed skill clickable and show, for
that one skill, where it is actually used across climate-relevant industries:
which occupations lean on it, which of our 30 climate fields employ those
occupations, at roughly what scale, and with what projected growth.

Two distinct jobs, and they should not be conflated:

1. **A user-facing view.** "Project management shows up in offshore wind,
   transmission buildout and building electrification; here is the shape of
   each." Today an LLM could write this. The point of adding data is that it
   stops being assertion.
2. **A check on the LLM.** A table that independently says "these occupations
   use this skill, and they are employed in these industries at this scale"
   gives us a way to score discovery output that does not require a human to
   read every answer. This is the more valuable half for Phase 3, and it is
   available even if the clickable view never ships.

The PRD already commits to the second job in spirit: *"A convincing explanation
of fit is not enough; concrete examples and requirements must come from
sources"* (PRD.md:18).

## 2. Why this is three hops, not one

There is no dataset anywhere that maps "skill" to "climate industry". Getting
there means chaining four vocabularies, and each link is a separate design
decision with a separate failure mode:

```
free-text skill        SOC / O*NET-SOC        NAICS industry        our 30 fields
"causal inference"  ->  15-2051 Data Sci.  ->  2211 Power Gen.  ->  onshore-wind
   (hop 1: linking)      (hop 2: official)      (hop 3: curation, ours)
```

- **Hop 1 — free-text skill to occupation. The hard one.** `profile.ts:172`
  types skills as `z.array(z.string())`: the LLM writes whatever phrase fits
  the user's card, so we have no controlled vocabulary to join on. O*NET's own
  skill list is only 35 elements (plus 33 knowledge and 52 abilities), far too
  coarse to receive "causal inference" or "colour grading". Options, best
  first, in §5.
- **Hop 2 — occupation to industry. Solved, officially, for free.** This is
  exactly what the BLS National Employment Matrix and OEWS
  industry-specific estimates are. No invention required.
- **Hop 3 — industry to our climate fields. Ours to curate, and the real
  risk.** No government anywhere publishes a "climate industry" list for the
  US (see §4). This is a hand-built mapping we own and must be able to defend.

## 3. Source catalogue

Licence column is the constraint that matters most: anything not open enough to
redistribute inside our Supabase reference collection is only usable as a live
API call, which changes the architecture.

### Tier 1 — build on these

| Source | What it gives us | Grain | Licence | Fit |
|---|---|---|---|---|
| [O*NET Database](https://www.onetcenter.org/database.html) (v31.0, released Aug 2026 **[verify]**) | `skills`, `knowledge`, `abilities`, `technology_skills`, `work_activities`, `alternate_titles`, `related_occupations`, `occupation_data` as flat files; also published as an RDF knowledge graph **[verify]** | ~900 O*NET-SOC occupations; importance + level ratings on a 1–5 / 0–100 scale | **CC BY 4.0** ([licence](https://www.onetcenter.org/license_db.html)) — redistributable with attribution | The backbone of hop 1 |
| [O*NET `related_occupations`](https://www.onetcenter.org/reports/Related.html) | 10 primary + 10 supplemental related occupations per occupation, built from what people do, what they know and what they are called. Replaced the older `career_changers_matrix` around v26.3 **[verify]** | occupation pair + rank | CC BY 4.0 | Directly encodes "a worker could move here with minimal extra preparation" — the PRD's core premise, from DOL rather than from us |
| [BLS Employment Projections skills data](https://www.bls.gov/emp/data/skills-data.htm) | Scores for **17 work-related skills** (creativity and innovation, interpersonal, leadership, project management, writing and reading, …) per projected occupation. Derived from O*NET by BLS; methodology in the [Oct 2024 MLR article](https://www.bls.gov/opub/mlr/2024/article/a-new-data-product-for-occupational-skills.htm) | 17 skills × ~830 occupations | US Gov, public domain | A short, human-legible skill axis — much better UI vocabulary than O*NET's raw 35, and the one to show a user |
| [BLS National Employment Matrix](https://www.bls.gov/emp/tables/industry-occupation-matrix-industry.htm) | Staffing patterns: employment of each occupation within each industry, 2024 base and 2034 projection | 832 occupations × 292 industries, XLSX | public domain | Hop 2, plus the only forward-looking number in the set |
| [BLS OEWS industry-specific estimates](https://www.bls.gov/oes/current/oessrci.htm) | Employment and wages by occupation for 450+ industries at 3/4/5-digit NAICS; [flat files](https://download.bls.gov/pub/time.series/oe/) and a [public API](https://www.bls.gov/developers/) | occupation × NAICS, national (also state/metro) | public domain | Hop 2 at finer NAICS grain than the matrix, and gives wages — which fellows ask about first |

### Tier 2 — climate-specific employment

| Source | What it gives us | Caveat |
|---|---|---|
| [DOE U.S. Energy & Employment Report](https://www.energy.gov/policy/us-energy-employment-jobs-report-useer) (2026 edition) | Employment across five energy sectors (Electric Power Generation; Transmission, Distribution and Storage; Fuels; Energy Efficiency; Motor Vehicles and Component Parts), national / state / county, plus wages, hiring difficulty and occupational breakdowns; published as a National Report, State Reports, **Public Data**, County Data and Appendices A–W. Built on ~42,800 employer survey responses combined with BLS data | Survey-based, so sector totals are estimates with error bars, and its sector taxonomy is energy-shaped: it covers maybe 12 of our 30 fields well and says nothing about climate finance, policy, comms or adaptation. Licence **[verify]** (DOE reports are normally public domain, but USEER is produced with the EFI Foundation and BW Research) |
| [O*NET Green Economy files, archived at v24.1](https://www.onetcenter.org/dictionary/24.1/excel/green_occupations.html) | 204 occupations classified Green New & Emerging / Green Enhanced Skills / Green Increased Demand, plus green task statements and green DWAs | **Removed from O*NET in release 24.2 (2020)** and only available from the archive. A 2020-vintage view of green work, pre-IRA. Usable as a curation scaffold; must not be presented to users as current |
| [NREL](https://www.nrel.gov/analysis/) / [EIA](https://www.eia.gov/) | Capacity, deployment and scenario data by technology and state | Not employment data. Useful for "is this field growing", not "who works in it" |
| [IRENA Renewable Energy and Jobs](https://www.irena.org/) | Global renewable-energy employment by technology | Country-level aggregates only; no occupational grain. Context, not grounding |

### Tier 3 — skill vocabulary and linking

| Source | What it gives us | Licence reality |
|---|---|---|
| [Lightcast Open Skills](https://lightcast.io/open-skills) | 32,000–35,000 normalised skill names with descriptions, types and hierarchy, updated fortnightly; plus a Skills Extractor that normalises free text | "Open" means visible and free to query, **not** an open licence: *"your use of the taxonomy is determined by the type of license you request"*, and the free tier is aimed at nonprofits pursuing a public good. Redistribution inside our repo is probably **not** permitted **[verify]**. Treat as an API dependency or skip |
| [ESCO](https://esco.ec.europa.eu/en/use-esco/download) | ~13,900 skills across 3,000+ occupations in 28 languages **[verify]**, of which [571 concepts are labelled green](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/green-skills-labelling-esco) (381 skills, 185 knowledge, 5 transversal); free download and [API](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/esco-api) | Free, redistributable **[verify exact terms]**. EU occupation frame (ISCO), so it does not join to BLS without an ISCO↔SOC crosswalk. The green labelling is the single best existing answer to "which skills are green skills" and is worth reading even if we stay US-only |
| [CareerOneStop Web APIs](https://www.careeronestop.org/Developers/WebAPI/technical-information.aspx) (DOL) | `Occupations by Skills Match`, `Skills Gaps Between Two Occupations` (wage, skills, knowledge, abilities, training, certification and licence gaps), `LMI by Occupation` | Free but requires registration and accepting a click-through data-sharing licence; API-only, so it cannot be pre-computed into our tables. The skills-gap endpoint is a ready-made "what would you have to learn" answer and worth a look for Stage 2 regardless of this feature |
| Academic green-skill measures — [Vona, Marin, Consoli & Popp, *Green Skills*](https://www.nber.org/system/files/working_papers/w21116/w21116.pdf) (NBER 21116; JAERE 5(4)) | A "greenness" score per occupation = green-specific tasks / total specific tasks, and a split of green skills into engineering-design and managerial-monitoring families. Finds ~11% of employment in green occupations | Methodology to reuse rather than a maintained dataset. Replication files not confirmed **[verify]**. Cite it if we build our own greenness score, so the method is not ours alone |

### Tier 4 — international, for after the alpha

Per the scoping decision for this document, we are US-first. Recorded so the
next person does not re-search it: [Eurostat EGSS accounts](https://ec.europa.eu/eurostat/databrowser/view/ENV_AC_EGSS1__custom_9733694/default/table)
give environmental-economy employment by NACE for 2000–2023 under the
CEPA/CReMA classification — the closest thing anywhere to an official
"climate industry" employment series, but EU-only and with no occupational
breakdown. OECD and ILO publish green-transition labour analysis at country
and sector level, useful for framing and useless for skill-level grounding.

### Ruled out

- **BLS Green Goods and Services survey.** The obvious candidate, and it is
  gone: BLS published its [second and final GGS release in March 2013](https://www.bls.gov/news.release/archives/ggqcew_03192013.htm)
  and eliminated all "measuring green jobs" products under sequestration,
  including employment by industry and occupation for producers of green goods
  and services. It had sampled ~120,000 worksites across 325 industries. **The
  US has had no official green-jobs-by-occupation series for 13 years**, which
  is the single most important fact in this document — it is why the mapping in
  §4 has to be ours.
- **LinkedIn's Global Green Skills Report.** The most-cited green-skills
  dataset in circulation, and off-limits: `linkedin.com` is a blocked domain
  enforced in `BLOCKED_SOURCE_DOMAINS` and by a SQL CHECK constraint. We cannot
  cite it in `data/*.yaml` or fetch it through `llm.ts`. Do not design around it.
- **Any job-postings corpus** (Lightcast postings, Indeed Hiring Lab, Revelio).
  Independently blocked by the PRD's "no self-built live job index or broad job
  corpus" constraint and by cost.

## 4. The gap we have to fill ourselves

Every Tier 1 source keys industry on NAICS. Our 30 fields
(`data/climate_fields.yaml`) are not NAICS — they are things like
`carbon-accounting-and-esg-software` and `environmental-justice-and-community-programs`.
Nobody publishes the bridge. So hop 3 is a hand-curated
`field_id -> [NAICS]` map, roughly 30 entries × 2–5 codes, and it is where this
feature will be right or wrong.

Three honest problems with it:

1. **Climate work hides inside conventional industries.** An offshore-wind
   project manager sits in NAICS 2211 (Electric Power Generation) or 5413
   (Engineering Services) next to a gas plant manager. NAICS cannot separate
   them. Any employment number we show for a field is therefore an upper bound
   on the industry that contains the field, not a count of climate jobs. The UI
   must say this in words, not in a footnote.
2. **Some fields have no NAICS home at all.** Carbon accounting software is
   5112/5415; climate policy advocacy is 8134; environmental justice
   programmes are 8139 — in each case the code covers a far larger and mostly
   unrelated population. For fields like these the right answer is to show the
   occupational picture and suppress the employment number.
3. **It ages.** NAICS revises every five years (2022 is current, 2027 next
   **[verify]**), and the field list will change as the reference collection
   grows.

Mitigations that make it defensible rather than arbitrary:

- Keep the map in `data/` as YAML with a `notes` field per entry stating what
  the NAICS code over-counts. `git diff data/` stays the changelog, exactly as
  the existing reference files work.
- Cross-check each energy field against USEER's sector employment. Where USEER
  and our NAICS aggregate disagree by an order of magnitude, the mapping is
  wrong or the caveat needs to be louder.
- Seed it from the archived O*NET green occupation list (§3 Tier 2) rather than
  from scratch: for 204 occupations someone at DOL already decided the work is
  green, which is a better starting point than our intuition even at 2020
  vintage.
- Store a confidence per field (`high` / `indicative` / `illustrative-only`) and
  let the UI render the number only at `high`.

## 5. Recommended shape, if we build it

**Hop 1 in three layers, cheapest first.** Do not try to solve free-text skill
matching in general:

1. **Literal match against O*NET Technology Skills and Tools.** "Python",
   "Tableau", "ArcGIS", "Adobe Premiere" are in `technology_skills.txt` as
   commodity titles already linked to occupations. For technical skills this is
   an exact join, no model involved, and it covers a large share of what our
   card extraction actually produces.
2. **The BLS 17-skill axis for everything else.** Ask the LLM to place a
   free-text skill onto the 17 BLS skills — a 17-way classification is a task a
   model does reliably, and unlike a free-text match it is auditable, because
   the mapping is small enough to eyeball in a fixture. Then read occupations
   off the BLS skills tables.
3. **Occupation-first as the fallback.** Where a skill will not map, use the
   user's own titles from their cards, resolve them via O*NET
   `alternate_titles`, and walk `related_occupations`. This is better grounded
   than skill matching anyway, because people have titles and titles are in the
   data.

**Pre-aggregate at build time; keep the raw extracts out of the repo.** Rough
sizes **[verify]**: O*NET Skills ≈ 61k rows (35 × ~900 × 2 scales), Technology
Skills ≈ 32k, Related Occupations ≈ 18k, and the National Employment Matrix and
OEWS industry files are in the hundreds of thousands of rows. None of that
belongs in Supabase or in git. A script should download them into a gitignored
cache, prune to the NAICS in our field map, aggregate to
`(field_id, occupation, skill, employment, projected_change, median_wage)` and
emit one derived CSV of maybe 5–10k rows plus the hand-curated map as YAML.
That keeps the reference collection "small and bounded" in the sense PLAN.md
means, keeps the only hand-edited artefact reviewable, and keeps the
provenance script in the repo so the derivation is reproducible.

**Everything stays on the existing rails.** Reads through `reference.ts`
(read-only, throws `ReferenceReadError`); any fetch through `llm.ts`; the
click-through is a `POST /api/turn` step like every other; the panel content
lands in `profile.md` through `profile.ts` helpers or not at all. No new fetch
path, no new client, no user data server-side — the panel is derived from the
profile the browser already sends.

## 6. How it checks the LLM

This is the part worth building first, because it needs no UI.

**A structural check for the Phase 3 evals (3.1).** For every
(skill, field) pair discovery asserts for a synthetic profile, ask the table:
do the occupations where that skill scores high have non-trivial employment in
that field's NAICS? Report three numbers per eval run:

- *supported* — the pair is in the table's top-N for that skill
- *plausible* — in the table but outside top-N
- *unsupported* — no employment of those occupations in that industry at all

That converts the current LLM-judge rubric question "grounded?" into a number
that does not need a model to compute, and it is a real baseline comparator:
the plain-prompt arm (step 3.2) can be scored the same way.

**A UI affordance later.** A "seen in BLS data" marker on fields the table
supports, and silence rather than a fake number where it does not. Never
suppress a field the LLM proposed just because NAICS cannot see it — the
industries where climate work hides inside conventional codes are precisely the
ones a career switcher most needs to hear about.

**The RAG path, post-alpha.** Once the derived table exists, the natural next
step is retrieval rather than generation: fetch the rows for the user's skills
and pass them into the discovery prompt as evidence, so the model is
summarising a table instead of recalling one. That is a Phase 4 conversation.
Worth noting that `llm.ts` already has the right shape for it (structured
outputs, cached system blocks) and that the retrieval would be a
`reference.ts` read, not a vector store — at 5–10k rows, keyed lookups are
enough and a vector index would be premature.

## 7. Obligations

- **O*NET is CC BY 4.0, not public domain.** Attribution is required wherever
  the data appears, including in the UI panel, not only in a README. O*NET
  publishes required wording **[verify]**, and O*NET OnLine additionally
  contains third-party content not covered by the CC licence — take data from
  the database download, not by scraping O*NET OnLine pages.
- **BLS output is public domain** but asks for citation, and the public API has
  rate limits and a registration tier **[verify]**.
- **Lightcast and CareerOneStop are licence-gated.** Neither can be
  redistributed in `data/`; both would be live dependencies with terms
  attached. Prefer doing without.
- **None of these hosts are blocked domains**, so `llm.ts`'s
  `assertToolsAllowed` allows them and `data/*.yaml` may cite them. Confirmed
  against `BLOCKED_SOURCE_DOMAINS`.

## 8. What has to be decided before any of this is built

1. **Does a derived BLS/O*NET table violate "no self-built live job index or
   broad job corpus"?** My reading is no: these are occupational statistics,
   they describe roles rather than openings, and they cannot power a job search
   — which is the same argument that already licenses the reference collection.
   But it is close enough to the line that it needs a PLAN.md §7 decision
   (next number: 36) before a step is written, not after.
2. **Alpha or post-alpha?** The eval check in §6 is cheap and improves Phase 3.
   The clickable panel is a new UI surface, a new reference table, a curation
   pass over 30 fields and an attribution obligation — that reads like a Phase 4
   epic, not a step to slip into Phase 2.
3. **Employment numbers in the UI: yes or no?** Showing "1.2M people work in
   this industry" when the climate slice might be 3% of it may mislead more
   than it grounds. An alternative that keeps the grounding and drops the false
   precision: show the *occupations* and *growth direction*, never the level.

## Sources

O*NET: [database](https://www.onetcenter.org/database.html) ·
[CC BY licence](https://www.onetcenter.org/license_db.html) ·
[OnLine content licence](https://www.onetonline.org/help/license) ·
[release archive](https://www.onetcenter.org/db_releases.html) ·
[Related Occupations report](https://www.onetcenter.org/reports/Related.html) ·
[Career Changers Matrix (superseded)](https://www.onetcenter.org/dictionary/23.3/text/career_changers_matrix.html) ·
[Green Occupations, archived at 24.1](https://www.onetcenter.org/dictionary/24.1/excel/green_occupations.html) ·
[Greening of the World of Work](https://www.onetcenter.org/reports/Green.html)

BLS: [EP skills data](https://www.bls.gov/emp/data/skills-data.htm) ·
[skills methodology, MLR Oct 2024](https://www.bls.gov/opub/mlr/2024/article/a-new-data-product-for-occupational-skills.htm) ·
[skills-based look at occupational data, MLR 2026](https://www.bls.gov/opub/mlr/2026/article/skills-savvy-a-skills-based-look-at-occupational-data.htm) ·
[top skills by detailed occupation](https://www.bls.gov/emp/tables/top-skills-by-detailed-occupation.htm) ·
[industry-occupation matrix](https://www.bls.gov/emp/tables/industry-occupation-matrix-industry.htm) ·
[EP databases](https://www.bls.gov/emp/data.htm) ·
[2024–34 projections overview](https://www.bls.gov/opub/mlr/2026/article/industry-and-occupational-employment-projections-overview.htm) ·
[OEWS national industry-specific](https://www.bls.gov/oes/current/oessrci.htm) ·
[OEWS data access](https://www.bls.gov/oes/data.htm) ·
[OEWS flat files](https://download.bls.gov/pub/time.series/oe/) ·
[QCEW NAICS crosswalks](https://www.bls.gov/cew/classifications/industry/qcew-naics-hierarchy-crosswalk.htm) ·
[Green Goods and Services, final release 2013](https://www.bls.gov/news.release/archives/ggqcew_03192013.htm) ·
[GGS survey results and collection, MLR 2013](https://www.bls.gov/opub/mlr/2013/article/green-goods-and-services-survey-results-and-collection.htm)

Energy and climate: [USEER hub](https://www.energy.gov/policy/us-energy-employment-jobs-report-useer) ·
[2026 USEER](https://www.energy.gov/policy/2026-us-energy-employment-report-useer) ·
[2025 USEER](https://www.energy.gov/policy/2025-us-energy-employment-report-useer) ·
[EFI Foundation USEER project](https://efifoundation.org/projects/useer/)

Skill taxonomies: [Lightcast Open Skills](https://lightcast.io/open-skills) ·
[Lightcast FAQs](https://lightcast.io/open-skills/faqs) ·
[Lightcast free API features](https://docs.lightcast.io/lightcast-api/docs/free-api-features) ·
[ESCO download](https://esco.ec.europa.eu/en/use-esco/download) ·
[ESCO API](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/esco-api) ·
[ESCO green labelling](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/green-skills-labelling-esco) ·
[ESCO green labelling report (PDF)](https://esco.ec.europa.eu/system/files/2025-01/Green%20Skills%20and%20Knowledge%20-%20Labelling%20ESCO.pdf) ·
[CareerOneStop Web API](https://www.careeronestop.org/Developers/WebAPI/technical-information.aspx) ·
[CareerOneStop skills gaps](https://www.careeronestop.org/Developers/WebAPI/SkillsGaps/get-skills-gaps-between-two-occupations.aspx) ·
[CareerOneStop skills match](https://www.careeronestop.org/Developers/WebAPI/Occupation/list-occupations-skills-match.aspx)

Method and international: [Vona et al., Green Skills (NBER 21116)](https://www.nber.org/system/files/working_papers/w21116/w21116.pdf) ·
[Green skills, CEPR column](https://cepr.org/voxeu/columns/green-skills) ·
[Measuring green jobs: task, skill and occupational data](https://www.sciencedirect.com/science/article/pii/S0954349X26001311) ·
[Eurostat EGSS employment](https://ec.europa.eu/eurostat/databrowser/view/ENV_AC_EGSS1__custom_9733694/default/table) ·
[EGSS glossary](https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Glossary%3AEnvironmental_goods_and_services_sector_%28EGSS%29) ·
[EGSS handbook](https://ec.europa.eu/eurostat/web/products-manuals-and-guidelines/-/ks-ra-09-012) ·
[ONS, time spent on green tasks](https://www.ons.gov.uk/economy/environmentalaccounts/articles/developingamethodformeasuringtimespentongreentasks/march2022)
