# Deep-research prompt

Why this exists: the research in `skill-to-industry-grounding.md` was done from
a sandbox whose egress policy blocked `onetcenter.org`, `bls.gov`,
`energy.gov`, `esco.ec.europa.eu` and `lightcast.io`, so every claim rests on
search-result summaries rather than on the pages themselves. The questions below
are the ones that need somebody (or something) that can actually open the file
listings, licence pages and API docs. Paste everything under the rule into a
deep-research session.

---

## Context

I am building an alpha web app that helps career switchers — specifically
Climatebase fellows — work out where their existing skills fit in climate work.
It is a Next.js + TypeScript app with a Supabase-backed reference collection of
30 curated climate fields, 113 example role profiles and 83 example job posts.
An LLM (Claude) does the reasoning: it reads a user's resume into experience
cards, infers skills from them, and proposes climate fields and roles that use
those skills.

Skills in the app are free text. The model writes phrases like "causal
inference", "stakeholder management", "colour grading" — there is no controlled
vocabulary.

The feature I am researching: make a confirmed skill clickable, and show the
user where that skill actually lands across climate-related industries — which
occupations use it, which climate industries employ those occupations, at what
scale, growing or shrinking. Equally important, and possibly more so: I want a
reputable independent dataset that lets me **check the LLM's claims** rather
than trusting them, so my evaluation harness can score "did the model assert a
skill-to-industry link the data supports?" without a human reading every answer.
Later, past the alpha, the same data could feed a RAG approach so the model
summarises a table instead of recalling one.

Hard constraints on what I can use:

- **No scraping LinkedIn, Indeed or Climatebase**, and no login automation or
  bypassing access restrictions anywhere. Those three domains are blocked in
  code. So LinkedIn's Global Green Skills Report and similar are unusable to
  me, however good they are.
- **No job-postings corpus.** I am explicitly not building a job index. Sources
  must describe occupations and industries, not openings.
- **Prefer sources I can redistribute** inside my own repo and database
  (public domain or a permissive open licence). API-only, licence-gated or
  registration-gated sources are a distant second choice, and I need to know
  which is which.
- US-first. International sources are of interest only as future work.
- This is a solo capstone project, so integration effort is a real cost.

What I already believe, from a first pass — please correct anything wrong:
the O*NET Database (CC BY 4.0) plus the BLS Employment Projections skills data,
BLS National Employment Matrix and BLS OEWS industry-specific estimates are the
usable backbone; BLS discontinued its Green Goods and Services survey in 2013 so
there is no current official US green-jobs-by-occupation series; O*NET removed
its green-economy files in release 24.2 (2020) and they survive only in the
24.1 archive; and bridging any of it to my 30 climate fields requires a
hand-curated field-to-NAICS mapping that nobody publishes.

## What I need answered

Answer with specifics — exact file names, column names, row counts, URLs,
licence wording, quota numbers — and say plainly when something does not exist.
A confirmed "this dataset does not exist" is as useful to me as a find.

**A. O*NET, verified at file level.**
1. Current database version and release date. For that version, the exact file
   names and columns of: skills, knowledge, abilities, technology skills, tools
   used, work activities, detailed work activities, alternate titles, related
   occupations, occupation data. Row counts each.
2. Is `related_occupations` the current successor to `career_changers_matrix`,
   and in which release did that change? What exactly does its index or rank
   column mean, and how is relatedness computed?
3. The green-economy files: confirm removal in 24.2, confirm the archive is
   still downloadable, and give the direct download URL for the 24.1 archive.
4. The precise attribution wording CC BY 4.0 requires for O*NET, as O*NET
   itself states it, and whether there are extra terms for the database
   download versus O*NET OnLine versus O*NET Web Services.
5. O*NET Web Services: free tier, rate limits, authentication, and whether
   there is an endpoint that takes an arbitrary skill phrase and returns
   occupations.
6. Is the RDF / knowledge-graph release real and current, and what does it add
   over the flat files?

**B. BLS, verified at file level.**
7. The Employment Projections skills data: the full list of the 17 skills, the
   exact tables published, their download URLs and formats, how the scores are
   scaled and comparable, and how they are derived from O*NET.
8. National Employment Matrix: current projection cycle, download URL, file
   layout, and how sparse the occupation-by-industry grid actually is.
9. OEWS industry-specific national estimates: download URL and layout for the
   current reference period, what the NAICS grain is, how suppression and
   non-disclosure are flagged, and whether the API covers industry-specific
   series or only geography.
10. BLS API: registration tiers, daily and per-query limits, and any terms of
    use I would be agreeing to by calling it from a server route.
11. Is there any *current* BLS product that touches green, clean-energy or
    climate employment — anything at all since GGS ended, including one-off
    articles, Spotlight pieces or QCEW special tabulations?
12. Does BLS or anyone else at DOL publish a crosswalk from NAICS to any
    green, clean or environmental industry grouping?

**C. Climate-specific employment data.**
13. The 2026 U.S. Energy & Employment Report: what is in the "Public Data" and
    appendix files, in what format, at what grain (technology, occupation,
    state, county, wage), and under what licence or terms — including whether
    the EFI Foundation or BW Research assert rights over it.
14. Does USEER publish employment by *occupation* within each energy
    technology, or only by technology and sector?
15. What else covers climate-sector employment in the US at industry or
    occupational grain, openly licensed? Consider E2's Clean Jobs America,
    NASEO, IREC's solar jobs census, state clean-energy jobs reports, and
    anything from EPA, EIA or NREL. For each: grain, licence, update cadence.
16. Is there any published, citable crosswalk from climate or clean-energy
    *sectors* to NAICS codes — from DOE, a national lab, Brookings, a
    university or a peer-reviewed paper? This is the single biggest gap in my
    plan and I would rather adopt someone's published mapping than invent one.

**D. Skill vocabularies and the linking problem.**
17. Lightcast Open Skills: what the free tier actually permits, whether the
    taxonomy may be redistributed or cached in my own database, what the
    licence types are, and whether a solo non-commercial capstone qualifies.
    Quote the relevant terms.
18. ESCO: exact licence for the download, whether the green labelling is in the
    standard download or separate, and whether a usable ISCO-to-SOC crosswalk
    exists and who maintains it.
19. CareerOneStop APIs: what the click-through licence permits, especially
    caching results and displaying them in my own UI; rate limits; and what the
    skills-gap endpoint returns in practice.
20. What open approaches exist for mapping arbitrary free-text skill phrases to
    O*NET elements or occupations? Look for published crosswalks, open-source
    linkers, Open Skills Network Rich Skill Descriptors, and any academic or
    government work on skill-phrase normalisation. Which are maintained?
21. Is there open data on **skill transferability between occupations**
    specifically — beyond O*NET's related-occupations file? Academic
    skill-distance or task-distance matrices with downloadable data count.

**E. Method and precedent.**
22. Who has already built "click a skill, see the industries" and grounded it
    in official statistics? Government career-explorer tools, university
    projects, open-source repos. What did they use for each hop, and where did
    they concede the mapping was fuzzy?
23. Published green-skill or occupational-greenness measures with available
    data: Vona et al.'s greenness score, ONS's green-task time-use method, and
    anything more recent. For each, is replication data downloadable?
24. What are the known measurement failure modes I should expect and design
    around — climate jobs hiding inside conventional NAICS codes, occupational
    coding lag, survey-versus-administrative discrepancies? Cite the critiques.

## Output I want

1. A ranked shortlist of sources to actually build on, with licence,
   redistributability, grain, update cadence and an honest integration-effort
   estimate for each.
2. A concrete recommendation for each of the three hops: free-text skill to
   occupation, occupation to industry, industry to climate field — including
   which hop to give up on if one has to be dropped.
3. Whether a citable climate-sector-to-NAICS crosswalk exists, and if so, the
   citation and the file.
4. An explicit list of dead ends, so I do not re-search them.
5. Every claim linked to a primary source. Where you are inferring rather than
   reading, say so.
