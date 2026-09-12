# Climate Career Exploration Tool \- Project Proposal;

## Problem

I want to work on climate but don't yet know which fields and roles are interesting and attainable given my resume. Job boards either don’t work well for career switchers as they overly index on current resume, or assume I already know what to search for.

From my personal evaluation, week of 9/7. See Appendix A for a more comprehensive review.

- LinkedIn recommended more roles resembling my current profile, even when I searched for climate keywords.  
- Indeed’s Career Scout understood I was looking for climate sectors, but returned 1 relevant result. They also didn’t match my seniority. *(Not a product I worked on, promise 😓)*

See [Climate Career Exploration Tool - Appendices](https://docs.google.com/document/d/1SemwE7Yv8-FaL7T5f4sg7KnYMPOdHzkfhfRH_n7juQ4/edit?tab=t.0) for many more resources.

**The focus is changing sectors.** Moving into climate does not necessarily mean changing occupation. A data scientist, videographer, or web designer will likely be able to keep using their core skills in a new field. The immediate problem is discovery: understanding my options well enough to choose what to pursue. Then mapping those options to queries understandable by key job boards (e.g. Indeed, LinkedIn, Climatebase).

## My scope decision

**Key hypothesis:** Frontier LLMs can help users recognize transferable skills and identify plausible climate fields and roles without custom model training. We need to test this. A convincing explanation of fit is not enough; concrete examples and requirements must come from sources.

**Focus: use existing skills in a new sector.** Keep the user's function and title where that makes sense. Distinguish a sector move from an adjacent role or a move requiring substantial retraining.

Three stages within discovery:

1. **Field and role discovery.** Given the user's resume and conversational input, have an LLM identify and describe climate fields and roles that use those skills. Must generalize across skill types, not just technical ones. Examples: videography, web design, and in my case machine learning and causal inference.  
   1. Help the user capture a few concrete experiences as editable plain-text cards: situation, actions, results, and possible skills demonstrated. The user confirms or corrects those interpretations.  
   2. Also establish key preferences: location, seniority, appetite for retraining, areas of climate interest. Ask progressively rather than making the user complete a long form before seeing value.

2. **Exploration and concretization.** Help the user explore those fields and narrow to promising roles. Output should be concrete job titles and companies, including example job posts and profiles sourced from publicly available websites. As terms of use prevent AI access, guide the user to explore LinkedIn Profiles with companies and/ or job titles.

   1. Explain the work and its connection to climate, not just the role title. Show why a path might fit, which experience supports that reasoning, and what remains uncertain. Let the user explore, reject, and revise options.

   2. LLM should continuously refine its context on the user and their job search targeting, carrying this across sessions. For capstone, consider keeping this context to a single .md that the user keeps rather than storing any user information.

3. **Sourcing and triage.** Generate job search queries, primarily keyword-based, to run against LinkedIn, Climatebase, Indeed and similar. Actual job search will be manual for the capstone project: the user sets up job alerts delivered to email.

   1. Ongoing job sourcing, email alert ingestion, deduplication, ranking, and application management are out of scope. There are many AI tools for this, including a very popular open source repo: [https://github.com/MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)

## Hard constraints

- **No scraping LinkedIn, Indeed, or Climatebase.** No login automation or bypassing access restrictions. For other sites, any automated collection must comply with their terms and access rules.  
- **No self-built live job index or broad job corpus.** A small, bounded reference collection is the only proposed exception. It exists to explain roles, not to power ongoing job search.  
- **No custom model training.** No embedding fine-tuning or transition models trained on trajectory datasets. We do not have the data, and hypothesize that we do not need it.  
- **User control over the profile.** Users can correct inferred skills and exclude experiences. Fellow profiles stay separate; using one person's information as an example for others requires their consent.  
- **Manual job search.** No automated job monitoring, application submission, or outreach in the capstone.  
- Must be buildable by one data scientist within a fellowship capstone timeframe. Start with the simplest interface that supports the conversation and preserves the user's work.

## Evaluation

**Target users:** Climatebase fellows who want to move into climate but are unsure where their existing skills fit. Start with my own case and a small pilot, roughly 5–8 fellows with different backgrounds. Include technical and nontechnical cases. This is formative feedback, not proof that the tool works equally well for every profession.

**The comparison is with what a fellow could do using a good general assistant.** Give a frontier model the same starting information, web-search access, and time budget, with a reasonable request to explore climate careers. Let it ask questions too. Compare that experience with the guided workflow. The point is to find out what the structure adds: better elicitation, clearer options, stronger evidence, or less effort.





