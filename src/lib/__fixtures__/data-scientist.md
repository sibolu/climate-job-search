# Profile

## Preferences

- **Location:** San Francisco Bay Area
- **Work mode:** hybrid
- **Seniority:** staff or senior; 9 years post-PhD
- **Retraining appetite:** high for domain knowledge, none for a new degree
- **Climate interests:** grid and storage, carbon markets integrity, methane monitoring (inferred)

## Experience Cards

### C1: Causal measurement platform for marketplace pricing
- **Years:** 2022–2025
- **Situation:** Staff data scientist at a two-sided marketplace where pricing experiments were confounded by seller behavior.
- **Actions:** Designed switchback and cluster-randomized experiments, built a causal-inference library (doubly robust estimators, synthetic controls) used by six teams, reviewed experiment designs company-wide.
- **Results:** Pricing decisions moved to the platform; a synthetic-control study on a fee change avoided a 4% GMV loss that the naive analysis had missed.
- **Skills:** causal inference, experiment design, Python, statistical modeling, technical leadership
- **Excluded:** no

### C2: Demand forecasting models in production
- **Years:** 2020–2022
- **Situation:** Forecasting team serving operations and finance.
- **Actions:** Built hierarchical time-series forecasts, owned the feature pipeline and the monitoring dashboards, migrated training to a scheduled batch system.
- **Results:** Forecast error down 22% year over year; models ran unattended for 18 months.
- **Skills:** time-series forecasting, MLOps, SQL, data pipelines
- **Excluded:** no

### C3: PhD in economics on program evaluation
- **Years:** 2014–2020
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
- **Sector:** Energy efficiency and demand response
- **Fit level:** strong
- **Summary:** Program evaluators must prove savings against a counterfactual, which is causal measurement. Your platform and PhD are the same method with a different outcome variable.
- **Chips:** causal inference, experiment design, program evaluation, production Python
- **Fit:** Utilities and their evaluators need exactly the quasi-experimental toolkit in C1 and C3 to measure program savings; C3 is literally the subject.
- **Evidence:**
  - C1: Built the causal measurement platform used for pricing decisions.
  - C3: Doctoral work on program evaluation methods.
- **Uncertain:** Whether staff-level roles exist outside a handful of evaluation consultancies.
- **Ask:**
  - Question: Would you take a consulting-firm role, or only in-house at a utility or software company?
  - Key: Consulting
  - Placeholder: e.g. in-house only
- **Sources:**
  - https://example.org/mv-evaluation-consultancy/careers
  - https://example.com/demand-response-platform/jobs

### F2: Grid-scale battery dispatch and forecasting
- **Status:** accepted
- **Explored:** yes
- **Move:** adjacent
- **Sector:** Grid-scale storage
- **Fit level:** some
- **Summary:** Battery operators forecast prices and load to schedule dispatch. Your forecasting models fit, but the market rules are new domain knowledge.
- **Chips:** forecasting, time series, optimization
- **Fit:** Storage operators forecast prices and load (C2) and evaluate bidding strategies with counterfactuals (C1).
- **Evidence:**
  - C2: Production demand forecasts feeding an operational system.
- **Uncertain:** Power-markets domain knowledge is expected; user rated own knowledge as beginner.
- **Ask:**
  - Question: How much of a role could be learning electricity-market rules before you would find it a poor fit?
  - Key: Domain ramp
  - Placeholder: e.g. a few months is fine
- **Sources:**
  - https://example.com/storage-operator/careers/data-scientist

### F3: Carbon credit integrity and ratings
- **Status:** unsure
- **Explored:** yes
- **Move:** sector
- **Sector:** Carbon markets
- **Fit level:** some
- **Summary:** Ratings agencies assess whether credits represent real reductions, a measurement problem with sparse data. The teams are small and the market is volatile.
- **Chips:** measurement, statistical rigour, sparse data
- **Fit:** Additionality is a causal question; C3's program evaluation maps directly onto baseline estimation.
- **Evidence:**
  - C3: Program-evaluation training on observational data.
- **Uncertain:** Sector is small and hiring is uneven; user unsure about the market's future.
- **Ask:**
- **Sources:**
  - https://example.org/carbon-ratings-agency/jobs

### F4: Climate risk modeling for insurers
- **Status:** rejected
- **Explored:** no
- **Move:** retraining
- **Sector:** Insurance and climate risk
- **Fit level:** stretch
- **Summary:** Catastrophe modeling needs physical-climate and actuarial knowledge you would have to build. You rejected the retraining.
- **Chips:** statistical modeling
- **Fit:** Statistical modeling (C1, C2) transfers, but catastrophe modeling is its own discipline.
- **Evidence:**
  - C2: Probabilistic forecasting at scale.
- **Uncertain:** User rejected: would require actuarial or physical-science retraining.
- **Ask:**
- **Sources:**
  - https://example.com/cat-modeling-firm/careers

## Role Shortlist

### R1: Staff Data Scientist, program measurement
- **Field:** F1
- **Companies:** Example DR Platform, Sample Evaluation Partners
- **Why:** Leads M&V methodology; C1 and C3 cover both the methods and the domain.
- **Selected:** yes
- **Sources:**
  - https://example.com/demand-response-platform/jobs/staff-data-scientist

### R2: Senior Data Scientist, market operations
- **Field:** F2
- **Companies:** Example Storage Operator, Sample Virtual Power Plant
- **Why:** Forecasting (C2) plus evaluation of dispatch changes (C1).
- **Selected:** no
- **Sources:**
  - https://example.com/storage-operator/careers/data-scientist

### R3: Quantitative Analyst, credit ratings
- **Field:** F3
- **Companies:** Example Carbon Ratings
- **Why:** Baseline and additionality analysis using C3's toolkit.
- **Selected:** yes
- **Sources:**
  - https://example.org/carbon-ratings-agency/jobs/quant-analyst

## Queries

### Q1: "data scientist" AND ("demand response" OR "energy efficiency" OR "measurement and verification")
- **Board:** linkedin
- **Fields:** F1
- **Role:** R1
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
