# G2c.1 recommendation: backbone sources and area cuts

The orchestrator's recommendation for gate G2c.1, drawn from the five
scorecard files in this folder and the [spot check](spot-check.md) (10 claims:
6 confirmed, 4 corrected). Nothing here is decided until it is recorded in
PLAN.md.

## What the survey showed

- **No single source covers all ten areas.** The broadest are Project
  Drawdown (strong on five areas) and the EU Taxonomy (partial on all ten
  after the spot check). Every jobs dataset (USEER, IRENA, IEA, E2) is about
  energy, by sector or technology, with no occupations.
- **Occupations are a separate layer, and it is solid.** O*NET-SOC (US) and
  ESCO (EU) are linked by an official Commission crosswalk (2022,
  CSV plus a technical report). O*NET's green tags are unchanged since
  release 17.0 (about 2012), so they can hint, not filter.
- **Open company lists are few.** Global Cleantech 100 (names in press
  releases; the full list is a download), the Breakthrough Energy portfolio,
  the Energy Impact Partners portfolio, Y Combinator's climate tag and
  CDR.fyi (only the top 10 of 176 suppliers is public). FT's Europe's
  Climate Leaders ranks incumbents. Currence (formerly Sightline Climate)
  and BloombergNEF are paid.
- **Licences are mostly unstated.** Only O*NET and the IEA's 2024 edition
  are confirmed CC BY 4.0. Later steps record names, titles and URLs, not
  copied data, so this matters less than it looks.

## Recommended backbone

Two layers shared by every area, then a field and company source per area.

| Layer | Source | Why |
|---|---|---|
| Occupations | O*NET-SOC (US) and ESCO (EU), joined by the ESCO–O*NET crosswalk | Official on both sides, current, linked; O*NET is CC BY 4.0 |
| Fields (default) | Project Drawdown solutions (13 sectors) | Only source strong on several areas at the level of a field |
| Fields (EU cross-check) | EU Taxonomy activities | NACE-keyed and the only source touching CF and CS; its NACE codes are indicative, not binding |

| Area | Field backbone | Companies from | Verdict |
|---|---|---|---|
| EN Energy | Drawdown; IEA World Energy Employment to size it | Global Cleantech 100, EIP, Breakthrough | Keep (best covered) |
| TR Transportation | Drawdown | Breakthrough, Global Cleantech 100 | Keep |
| BE Built Environment | Drawdown | Breakthrough | Keep |
| FA Food & Agriculture | Drawdown | Breakthrough | Keep |
| CR Carbon Removal | Drawdown, CDR.fyi supplier list | CDR.fyi (top 10 public), Y Combinator | Keep (pilot area) |
| IM Industry & Materials | EU Taxonomy manufacturing activities; Drawdown (partial) | Breakthrough, Global Cleantech 100 | Keep |
| CE Circular Economy | EU Taxonomy circular activities; Ellen MacArthur Foundation concepts | Global Cleantech 100 (partial) | Keep, thin on companies |
| NW Nature & Water | EU Taxonomy; Eurostat EGSS; Drawdown (partial) | None found | Keep, thinnest of the kept areas |
| CF Climate Finance | EU Taxonomy (insurance only); PwC (partial) | None found | Decide at the gate (below) |
| CS Corporate Sustainability & Climate Services | EU Taxonomy (consultancy only); PwC, FT (partial) | None found | Decide at the gate (below) |

## The one real choice: Climate Finance and Corporate Sustainability

Both look thin, but the survey did not look where their sources are. They
are cross-sector service areas, and their natural sources (finance-sector
climate bodies, disclosure and accounting standard setters, their member
lists) fall outside all five source families. The one finance source
attempted, Climate Policy Initiative, failed to load.

- **Recommended: one more survey worker** on finance and disclosure sources
  for CF and CS only, in the same scorecard format, before deciding (one
  Sonnet worker, a few minutes).
- **Or keep them unsurveyed:** 2c.3 builds them from the occupation layer
  and company career pages, with no field backbone.
- **Or cut them** and leave the app's six areas plus Industry & Materials
  and Nature & Water.

The pilot areas (Energy, best data; Carbon Removal, worst) stand as planned.
