# US federal statistics and occupation systems

Retrieved 2026-11-23. Format per [README.md](README.md).

| Source | Geography | Granularity | Last update | Licence | Coverage |
|---|---|---|---|---|---|
| [O*NET Green Occupations](https://www.onetcenter.org/dictionary/23.0/text/green_occupations.html) | US | 204 O*NET-SOC rows | O*NET 31.0, Aug 2026; green file unchanged since 17.0 | CC BY 4.0 | partial |
| [OEWS](https://www.bls.gov/oes/) | US | about 830 occupations | May 2026 release | not found | none (not green) |
| [GGS](https://www.bls.gov/ggs/) | US | industry, 2011 data | discontinued 2013 | not found | none confirmed |
| [USEER](https://www.energy.gov/policy/us-energy-employment-jobs-report-useer) | US | energy sub-sectors | 2026 | not found | thin |
| [NREL occupational estimates](https://catalog.data.gov/dataset/national-occupational-estimates-2023) | US | energy staffing patterns | 2023 | not found | thin |

Crosswalk finding: an official ESCO–O*NET occupations crosswalk exists (https://esco.ec.europa.eu/en/use-esco/other-crosswalks). No official ESCO–ISCO or ESCO–SOC crosswalk found on that page. BLS publishes ISCO-08 to 2010 SOC (https://www.bls.gov/soc/soccrosswalks.htm) and 2010 to 2018 SOC (https://www.bls.gov/soc/2018/crosswalks.htm); the BLS process note flags weak matches (https://www.bls.gov/soc/ISCO_SOC_Crosswalk_process.pdf).

### O*NET Green Occupations file (O*NET Resource Center, US DOL)

- **URL:** https://www.onetcenter.org/dictionary/23.0/text/green_occupations.html
- **Retrieved:** 2026-11-23
- **What it is:** A list of O*NET-SOC occupations tagged as Green New & Emerging, Green Enhanced Skills or Green Increased Demand.
- **Geography:** US
- **Granularity:** One row per O*NET-SOC occupation with one of three green categories; 204 rows. https://www.onetcenter.org/dictionary/23.0/text/green_occupations.html
- **Last update and cadence:** File added in release 16.0, no structure changes through 23.0 (https://www.onetcenter.org/dictionary/23.0/text/green_occupations.html); the O*NET database itself is at 31.0, August 2026, with releases every three to four months (https://www.onetcenter.org/db_releases.html). The green tagging appears frozen (inference from no structure change; content age not found).
- **Format and licence:** Part of the O*NET database download; Creative Commons Attribution 4.0 International. https://www.onetcenter.org/db_releases.html
- **Trades vs professional skew:** not found; the file mixes professional and trades occupations, no skew statement on the page. https://www.onetcenter.org/dictionary/23.0/text/green_occupations.html
- **US–EU occupation crosswalk:** yes, via O*NET-SOC codes: the European Commission publishes an ESCO–O*NET occupations crosswalk (CSV) at https://esco.ec.europa.eu/en/use-esco/other-crosswalks with a technical report at https://esco.ec.europa.eu/en/about-esco/publications/publication/crosswalk-between-esco-and-onet-technical-report
- **Coverage of the ten areas:**

  | Area | Coverage | Evidence |
  |---|---|---|
  | CE | none | not found; the archived sector list does not name waste or recycling. https://webarchive.library.unt.edu/web/20120916120535/http://www.onetcenter.org/green.html |
  | BE | partial | archived green sectors include green construction. https://webarchive.library.unt.edu/web/20120916120535/http://www.onetcenter.org/green.html |
  | TR | partial | archived green sectors include transportation. https://webarchive.library.unt.edu/web/20120916120535/http://www.onetcenter.org/green.html |
  | EN | strong | archived green sectors include renewable energy generation and energy efficiency. https://webarchive.library.unt.edu/web/20120916120535/http://www.onetcenter.org/green.html |
  | FA | none | not found; not named on the source page |
  | CR | none | not found; not named on the source page |
  | CF | none | not found; not named on the source page |
  | IM | none | not found; not named on the source page |
  | NW | partial | archived sectors include environmental protection (conservation not confirmed). https://webarchive.library.unt.edu/web/20120916120535/http://www.onetcenter.org/green.html |
  | CS | none | not found; not named on the source page |

- **Notes:**
- Taxonomy is O*NET-SOC, so rows join directly to SOC and, through the crosswalk, ESCO.
- The sector framework (renewable energy generation, transportation, energy efficiency, green construction, environmental protection) is only on an archived 2012 page: https://webarchive.library.unt.edu/web/20120916120535/http://www.onetcenter.org/green.html

### Occupational Employment and Wage Statistics, OEWS (Bureau of Labor Statistics)

- **URL:** https://www.bls.gov/oes/
- **Retrieved:** 2026-11-23
- **What it is:** Annual employment and wage estimates by occupation, industry and area.
- **Geography:** US
- **Granularity:** Approximately 830 occupations (SOC), by nation, state and metro area. https://www.bls.gov/oes/
- **Last update and cadence:** News release 15 May 2026 covering May 2025 data; annual. https://www.bls.gov/oes/
- **Format and licence:** Web tools and data tables; licence not stated on the page (copyright page not read). https://www.bls.gov/oes/
- **Trades vs professional skew:** balanced; covers all occupations, so skew follows the occupations chosen, not the source. https://www.bls.gov/oes/
- **US–EU occupation crosswalk:** SOC-based; the BLS ISCO-08 to 2010 SOC crosswalk is at https://www.bls.gov/soc/soccrosswalks.htm and the 2010 to 2018 SOC crosswalk at https://www.bls.gov/soc/2018/crosswalks.htm; no direct ISCO-08 to SOC 2018 file found. ESCO side: https://esco.ec.europa.eu/en/use-esco/other-crosswalks
- **Coverage of the ten areas:**

  | Area | Coverage | Evidence |
  |---|---|---|
  | CE | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | BE | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | TR | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | EN | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | FA | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | CR | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | CF | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | IM | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | NW | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |
  | CS | none | not green-specific; all occupations, no climate tagging. https://www.bls.gov/oes/ |

- **Notes:**
- Useful as the wage and employment layer under any SOC-coded role list, not as a climate selector.
- BLS Employment Projections (same site, https://www.bls.gov/emp/) were not read; skipped for budget.

### Green Goods and Services survey, GGS (Bureau of Labor Statistics)

- **URL:** https://www.bls.gov/ggs/
- **Retrieved:** 2026-11-23
- **What it is:** A survey of about 120,000 establishments measuring employment in industries producing goods or services that benefit the environment.
- **Geography:** US (national and state)
- **Granularity:** Industry-level employment, with occupation and wage data for green jobs; industry list not on the page. https://www.bls.gov/ggs/
- **Last update and cadence:** Last data: 2011 survey released 19 March 2013; program eliminated after the 1 March 2013 sequestration order, so discontinued. https://www.bls.gov/ggs/
- **Format and licence:** Archived tables and a technical note PDF (https://www.bls.gov/ggs/ggs_technote_extended.pdf); licence not found. https://www.bls.gov/ggs/
- **Trades vs professional skew:** not found; no skew statement read. https://www.bls.gov/ggs/
- **US–EU occupation crosswalk:** NAICS and SOC based; no ESCO or ISCO link found. See https://www.bls.gov/ggs/data.htm
- **Coverage of the ten areas:**

  | Area | Coverage | Evidence |
  |---|---|---|
  | CE | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | BE | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | TR | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | EN | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | FA | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | CR | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | CF | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | IM | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | NW | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |
  | CS | none | industry list not read; coverage not confirmed. https://www.bls.gov/ggs/ |

- **Notes:**
- Data are 13+ years old; the area ratings above are unconfirmed, not evidence of absence.
- Methodology: https://www.bls.gov/ggs/ggsoverview.htm

### US Energy and Employment Report, USEER (US Department of Energy)

- **URL:** https://www.energy.gov/policy/us-energy-employment-jobs-report-useer
- **Retrieved:** 2026-11-23
- **What it is:** Annual DOE report on energy-sector employment by technology.
- **Geography:** US (national, state, county)
- **Granularity:** National report, state reports, county data, public data, appendices; occupation detail not described on the page. https://www.energy.gov/policy/us-energy-employment-jobs-report-useer
- **Last update and cadence:** Page updated 3 September 2026 and lists a 2026 report, though a notice points to 2025 as the most recent; annual, reports 2016 to 2025 linked. https://www.energy.gov/policy/us-energy-employment-jobs-report-useer
- **Format and licence:** Report PDFs and public data; licence not stated. https://www.energy.gov/policy/us-energy-employment-jobs-report-useer
- **Trades vs professional skew:** not found on the page; energy-sector scope suggests trades-heavy (inference). https://www.energy.gov/policy/us-energy-employment-jobs-report-useer
- **US–EU occupation crosswalk:** SOC/NAICS based per the NLR dataset below; no direct crosswalk found. https://catalog.data.gov/dataset/national-occupational-estimates-2023
- **Coverage of the ten areas:**

  | Area | Coverage | Evidence |
  |---|---|---|
  | CE | none | not found; not named on the source page |
  | BE | none | not found; not named on the source page |
  | TR | none | not found; not named on the source page |
  | EN | strong | energy employment is the report's subject. https://www.energy.gov/policy/us-energy-employment-jobs-report-useer |
  | FA | none | not found; not named on the source page |
  | CR | none | not found; not named on the source page |
  | CF | none | not found; not named on the source page |
  | IM | none | not found; not named on the source page |
  | NW | none | not found; not named on the source page |
  | CS | none | not found; not named on the source page |

- **Notes:**
- Sector breakdown (generation, fuels, efficiency, vehicles) could not be confirmed from the page.
- Appendix contents not read.

### National Occupational Estimates 2023 (NREL, now National Laboratory of the Rockies)

- **URL:** https://catalog.data.gov/dataset/national-occupational-estimates-2023
- **Retrieved:** 2026-11-23
- **What it is:** Occupational staffing-pattern estimates across USEER energy sub-sectors, built from BLS industry-occupation matrix data via 6-digit NAICS.
- **Geography:** US
- **Granularity:** Occupation shares by energy sub-technology; row count not found. https://catalog.data.gov/dataset/national-occupational-estimates-2023
- **Last update and cadence:** Dataset year 2023; one-off or cadence not found. https://catalog.data.gov/dataset/national-occupational-estimates-2023
- **Format and licence:** XLSX on OpenEI (https://data.openei.org/submissions/8660); licence not found. https://catalog.data.gov/dataset/national-occupational-estimates-2023
- **Trades vs professional skew:** not found; energy sub-sectors imply trades-heavy (inference). https://catalog.data.gov/dataset/national-occupational-estimates-2023
- **US–EU occupation crosswalk:** SOC based; no direct crosswalk. ESCO side: https://esco.ec.europa.eu/en/use-esco/other-crosswalks
- **Coverage of the ten areas:**

  | Area | Coverage | Evidence |
  |---|---|---|
  | CE | none | not found; not named on the source page |
  | BE | none | not found; not named on the source page |
  | TR | none | not found; not named on the source page |
  | EN | strong | staffing patterns for energy sub-sectors. https://catalog.data.gov/dataset/national-occupational-estimates-2023 |
  | FA | none | not found; not named on the source page |
  | CR | none | not found; not named on the source page |
  | CF | none | not found; not named on the source page |
  | IM | none | not found; not named on the source page |
  | NW | none | not found; not named on the source page |
  | CS | none | not found; not named on the source page |

- **Notes:**
- No standalone NREL clean-energy occupation taxonomy was found; this dataset is the closest. Workforce pages: https://www.nlr.gov/workforce/analysis
