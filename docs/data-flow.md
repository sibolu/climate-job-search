# How the app gets from a pasted resume to search queries

One diagram, kept at the level of "what talks to what". Implementation details
(models, prompts, validation rules) live in the code and PLAN.md and change
often; this stays stable. Keep it current when a step, a data store or a
source of ground truth is added or removed.

```mermaid
flowchart TD
  YOU(["You: paste resume or bio, answer a few questions,<br/>accept or reject fields, rate queries"]):::person

  YOU --> CARDS{{"LLM turns the text into experience cards"}}:::llm
  CARDS --> PROFILE[("Your profile<br/>stored only in your browser,<br/>sent whole to the server each turn")]:::store

  PROFILE --> DISCOVER{{"LLM matches your cards and preferences<br/>to climate fields and roles"}}:::llm
  REF[("Reference collection<br/>climate fields, example roles, example job posts<br/>curated in the repo, mirrored to Supabase")]:::store --> DISCOVER
  WEB(["Web search and fetch<br/>LinkedIn, Indeed and Climatebase blocked"]):::web --> DISCOVER
  DISCOVER --> CHECK["Code keeps only fields and roles that<br/>cite one of your cards and a real, allowed source"]:::code
  CHECK --> PROFILE

  PROFILE --> EXPLORE{{"LLM drills into a field you pick<br/>using its reference rows plus the web"}}:::llm
  REF --> EXPLORE
  WEB --> EXPLORE
  EXPLORE --> PROFILE

  PROFILE --> QUERIES{{"LLM writes board-ready search queries<br/>from your accepted fields, no web, no reference data"}}:::llm
  QUERIES --> PROFILE
  PROFILE --> BOARDS(["You run the queries on the job boards yourself<br/>and rate them good or bad fit"]):::person
  BOARDS --> REVISE{{"LLM revises the queries from your feedback"}}:::llm
  REVISE --> PROFILE

  DISCOVER -. "tokens and cost only, no content" .-> USAGE[("Anonymous usage log<br/>Supabase")]:::store
  EXPLORE -.-> USAGE
  QUERIES -.-> USAGE
  REVISE -.-> USAGE
  CARDS -.-> USAGE

  classDef person fill:#dcfce7,stroke:#15803d,color:#111
  classDef store fill:#dbeafe,stroke:#1d4ed8,color:#111
  classDef llm fill:#ede9fe,stroke:#6d28d9,color:#111
  classDef web fill:#ffedd5,stroke:#c2410c,color:#111
  classDef code fill:#f3f4f6,stroke:#4b5563,color:#111
```

**Reading the colours.** Green is you. Blue is stored data. Purple is a model
call. Orange is the open web. Grey is a plain code check.

**Where the ground truth is.**

- Your own words: the pasted text, your answers, your accept/reject clicks
  and your query ratings. Everything the model says about you must trace back
  to a card made from your text.
- The reference collection: a small, hand-curated set of climate fields,
  example roles and example job posts kept as YAML in the repo. It explains
  fields and roles; it never powers a search.
- The web: used only to confirm employers and to source fields the
  collection lacks, with the three job boards blocked.

**Where nothing is stored.** The server keeps no profile, chat or pasted
text. Your profile lives in your browser and is resent every turn. The only
server-side write is a usage row with token counts and cost.

Last verified against the code: 2026-09-18.
