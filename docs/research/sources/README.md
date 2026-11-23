# Source survey (PLAN.md step 2c.1)

One file per source family, each holding one scorecard per source, all in
the format below. The survey feeds gate G2c.1: pick a backbone source per
climate area and cut any area the sources cover thinly.

| File | Family |
|---|---|
| [us-federal.md](us-federal.md) | US federal statistics and occupation systems |
| [eu.md](eu.md) | EU institutions and agencies |
| [international.md](international.md) | International bodies |
| [ngo-academic.md](ngo-academic.md) | NGOs, think tanks and academic work |
| [climate-tech.md](climate-tech.md) | Climate-tech taxonomies and company lists |
| [spot-check.md](spot-check.md) | Ten load-bearing claims checked against their sources |
| [recommendation.md](recommendation.md) | The orchestrator's G2c.1 recommendation |

## Rules

- Scope: US plus EU; professional career switchers (trades are out, but a
  source's trades skew is recorded).
- Every claim carries a URL, written in full (`https://…`) so the link check
  finds it. Pages on linkedin.com, indeed.com and climatebase.org are never
  cited. LinkedIn's Green Skills Report is not used.
- "Not found" is an answer; a guess is not. Write "not found" when a fact
  could not be confirmed from the source.
- Link check: `pnpm research:check-links` (every URL resolves, none on a
  blocked domain).

## The ten areas

Six from the app's interest question (`CLIMATE_AREAS`), four added for the
research. Adaptation and resilience are tagged inside an area, not an area.

| Key | Area |
|---|---|
| CE | Circular Economy |
| BE | Built Environment |
| TR | Transportation |
| EN | Energy |
| FA | Food & Agriculture |
| CR | Carbon Removal |
| CF | Climate Finance (climate risk, insurance, carbon markets) |
| IM | Industry & Materials (steel, cement, chemicals, hydrogen, industrial heat) |
| NW | Nature & Water (conservation, forestry, oceans, water systems) |
| CS | Corporate Sustainability & Climate Services (carbon accounting, disclosure, climate data and software, policy and advocacy) |

## Scorecard format

Each family file opens with a summary table (one row per source: name,
geography, granularity, last update, licence, one-word overall coverage),
then one scorecard per source:

```markdown
### <Source name> (<publisher>)

- **URL:** https://…
- **Retrieved:** 2026-11-23
- **What it is:** one sentence.
- **Geography:** US | EU | both | global (and which EU countries, if partial)
- **Granularity:** what one row is (an industry code, an occupation code at
  which level, a skill, a company, a project) and how many rows. URL.
- **Last update and cadence:** date of the latest release; annual, one-off,
  discontinued. URL.
- **Format and licence:** CSV / API / PDF / web only; licence name or terms.
  URL.
- **Trades vs professional skew:** trades-heavy | balanced |
  professional-heavy, with one line of evidence. URL.
- **US–EU occupation crosswalk:** whether an official crosswalk to the other
  side's occupation system exists (O*NET/SOC ↔ ESCO/ISCO), with its URL; or
  "not applicable" for sources with no occupation codes.
- **Coverage of the ten areas:**

  | Area | Coverage | Evidence |
  |---|---|---|
  | CE | strong / partial / none | one line + URL |
  | … (all ten rows) | | |

- **Notes:** anything else a backbone decision needs (method caveats,
  known gaps, paywalls). One to three bullets.
```
