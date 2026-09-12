# Profile

## Preferences

- **Location:** San Francisco Bay Area
- **Work mode:** hybrid
- **Seniority:** staff or senior; 9 years post-PhD
- **Retraining appetite:** high for domain knowledge, none for a new degree
- **Climate interests:** grid and storage, carbon markets integrity, methane monitoring (inferred)

## Experience Cards

### C1: Causal measurement platform for marketplace pricing
- **Situation:** Staff data scientist at a two-sided marketplace where pricing experiments were confounded by seller behavior.
- **Actions:** Designed switchback and cluster-randomized experiments, built a causal-inference library (doubly robust estimators, synthetic controls) used by six teams, reviewed experiment designs company-wide.
- **Results:** Pricing decisions moved to the platform; a synthetic-control study on a fee change avoided a 4% GMV loss that the naive analysis had missed.
- **Skills:** causal inference, experiment design, Python, statistical modeling, technical leadership
- **Excluded:** no

### C2: Demand forecasting models in production
- **Situation:** Forecasting team serving operations and finance.
- **Actions:** Built hierarchical time-series forecasts, owned the feature pipeline and the monitoring dashboards, migrated training to a scheduled batch system.
- **Results:** Forecast error down 22% year over year; models ran unattended for 18 months.
- **Skills:** time-series forecasting, MLOps, SQL, data pipelines
- **Excluded:** no

### C3: PhD in economics on program evaluation
- **Situation:** Dissertation on the effect of an energy-efficiency subsidy using administrative data.
- **Actions:** Difference-in-differences and regression discontinuity designs on a large panel; published two papers.
- **Results:** One paper cited in a state regulatory filing.
- **Skills:** econometrics, program evaluation, policy analysis, academic writing
- **Excluded:** no

## Skills

- **Confirmed:** causal inference, experiment design, Python, time-series forecasting, econometrics
- **Inferred:** MLOps, technical leadership, policy analysis
- **Excluded:** deep learning research

## Fields

### F1: Measurement and verification for demand response and efficiency programs
- **Status:** accepted
- **Explored:** yes
- **Move:** sector
- **Fit:** Utilities and their evaluators need exactly the quasi-experimental toolkit in C1 and C3 to measure program savings; C3 is literally the subject.
- **Uncertain:** Whether staff-level roles exist outside a handful of evaluation consultancies.
- **Sources:**
  - https://example.org/mv-evaluation-consultancy/careers
  - https://example.com/demand-response-platform/jobs

### F2: Grid-scale battery dispatch and forecasting
- **Status:** accepted
- **Explored:** yes
- **Move:** adjacent
- **Fit:** Storage operators forecast prices and load (C2) and evaluate bidding strategies with counterfactuals (C1).
- **Uncertain:** Power-markets domain knowledge is expected; user rated own knowledge as beginner.
- **Sources:**
  - https://example.com/storage-operator/careers/data-scientist

### F3: Carbon credit integrity and ratings
- **Status:** unsure
- **Explored:** yes
- **Move:** sector
- **Fit:** Additionality is a causal question; C3's program evaluation maps directly onto baseline estimation.
- **Uncertain:** Sector is small and hiring is uneven; user unsure about the market's future.
- **Sources:**
  - https://example.org/carbon-ratings-agency/jobs

### F4: Climate risk modeling for insurers
- **Status:** rejected
- **Explored:** no
- **Move:** retraining
- **Fit:** Statistical modeling (C1, C2) transfers, but catastrophe modeling is its own discipline.
- **Uncertain:** User rejected: would require actuarial or physical-science retraining.
- **Sources:**
  - https://example.com/cat-modeling-firm/careers

## Role Shortlist

### R1: Staff Data Scientist, program measurement
- **Field:** F1
- **Companies:** Example DR Platform, Sample Evaluation Partners
- **Why:** Leads M&V methodology; C1 and C3 cover both the methods and the domain.
- **Sources:**
  - https://example.com/demand-response-platform/jobs/staff-data-scientist

### R2: Senior Data Scientist, market operations
- **Field:** F2
- **Companies:** Example Storage Operator, Sample Virtual Power Plant
- **Why:** Forecasting (C2) plus evaluation of dispatch changes (C1).
- **Sources:**
  - https://example.com/storage-operator/careers/data-scientist

### R3: Quantitative Analyst, credit ratings
- **Field:** F3
- **Companies:** Example Carbon Ratings
- **Why:** Baseline and additionality analysis using C3's toolkit.
- **Sources:**
  - https://example.org/carbon-ratings-agency/jobs/quant-analyst

## Queries

### Q1: "data scientist" AND ("demand response" OR "energy efficiency" OR "measurement and verification")
- **Board:** linkedin
- **Fields:** F1
- **Status:** good
- **Reason:** three relevant senior roles, one at a platform vendor
- **Changed:** 2026-09-07

### Q2: "data scientist" battery storage forecasting
- **Board:** linkedin
- **Fields:** F2
- **Status:** bad
- **Reason:** all roles required a power-markets or electrical engineering background as a hard requirement
- **Changed:** 2026-09-08

### Q3: causal inference
- **Board:** climatebase
- **Fields:** F1, F3
- **Status:** untried
- **Reason:**
- **Changed:**

### Q4: "carbon credits" analyst
- **Board:** other
- **Fields:** F3
- **Status:** untried
- **Reason:**
- **Changed:**

## Session Notes

Discovery ran on turn 4 with the reference collection plus web search; F1 and F2 accepted immediately.
Q2 feedback suggests narrowing F2 to analytics-vendor roles rather than operator roles, or adding a power-markets course to the plan; ask the user which.
Next: explore F3 with concrete example posts and ask whether hybrid means up to three days on-site.
