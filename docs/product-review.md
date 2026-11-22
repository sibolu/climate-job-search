# Climate Career Exploration Tool: Product Review

2026-11-15. Based on [PRD.md](../PRD.md), [PLAN.md](../PLAN.md) and
[docs/data-flow.md](data-flow.md) only.

## Summary

The core idea is sound and the scope is well cut. Two things need attention before the pilot. The build shows less sourced evidence than the PRD requires. And nothing in the plan tests the final output, the search queries, against a real job board.

This review reads only PRD.md, PLAN.md and docs/data-flow.md. Points I could not confirm without the code are listed in Appendix D.

### What I like

- **Sector move, same function.** No job board makes this promise, and it explains why the field board is the spine of the UI.
- **Experience cards as the editable middle layer.** Every field must cite a card, enforced in code, and the user can correct or exclude cards.
- **Honest provenance.** Links come only from the curated collection. A field named from model memory carries no link.
- **The loop closes on real boards.** Rating a query after running it is the only point where outside ground truth enters. Most tools stop before it.
- **The profile stays in the browser.** That lowers the trust barrier for fellows and keeps the user the owner.
- **The evaluation asks the right question:** what does the structure add over a good general assistant?

### What I would do differently

1. **Test a sharper hypothesis.** The stated one (frontier models find transferable skills without training) is also true of the baseline. The real claim is that a guided flow plus a curated catalogue beats a general assistant with web search. Fix the pass or fail rule before the pilot.
2. **Restore sourced concreteness.** The PRD says examples and requirements must come from sources, and Stage 2 promises example posts, companies and LinkedIn guidance. Since Phase 2b, discovery has no web access and the drill-down and example posts have no UI path. The baseline arm does have web search, so as built the app will probably lose on evidence.
3. **Treat the citation check as necessary, not sufficient.** It proves a field names a card. It does not prove the card supports the field. Fit level and "attainable" have no ground truth yet.
4. **Give the query reviser more than a thumb.** Good or bad fit does not say why, and the model cannot see results. Let the user tell it: a reason pill and a few pasted result titles.
5. **Design the pilot for 5–8 people.** Moderated sessions, both arms per fellow in alternating order, fields rated blind, and a check-in after a week of alerts.

### How to validate

Each step gets one offline check that needs no LLM judge and one pilot signal (Appendix C). Two measures matter most: new and plausible fields per session, and the share of the first 10 results per query that fit.

## Prioritized list

Eleven items in three tiers; the first three need your hands and unblock the rest. Effort figures are rough estimates.

### P0: this week

| # | What to do | Why | Effort |
| --- | --- | --- | --- |
| 1 | Run G2b.1 as a small study on yourself. Before pasting, write down the fields and titles you already know. Afterwards label each field new or known, plausible or not. Run the baseline prompt the same day. | It blocks the merge and all of Phase 3. It is also the first real data on novelty, and your September LinkedIn searches are a ready comparison. | Half a day, you |
| 2 | Rewrite the key hypothesis as a comparison and write down the decision rule. Example: the guided flow yields more new and plausible fields and better query results than the baseline, for no more effort. Say what you will do if it does not. | Without a rule set in advance, any pilot outcome reads as success. A clear negative result is still a valid capstone finding. | 1 hour, you |
| 3 | Hand-score queries on the real boards. Four eval profiles × two fields × three boards is 24 queries. Record the result count and how many of the first 10 fit. Do the same for the baseline's queries. | Queries are the final output, and no step, eval or judge in the plan can see a board. The constraints make this manual. | Half a day, you |

### P1: before the pilot

| # | What to do | Why | Effort |
| --- | --- | --- | --- |
| 4 | Reorder step 3.1: deterministic and metamorphic checks first, LLM judge second. Stability, personalization, preference sensitivity, card exclusion, card faithfulness, catalogue coverage by function (Appendix C). Label about 40 items by hand before trusting the judge. | These checks are cheap and need no ground truth. They catch failures a judge from the same model family will miss. | 1–2 days, Claude |
| 5 | Put sourced examples back on the expanded field card: the catalogue's example posts and role profile, LinkedIn people-search guidance links, and where each employer name came from. Check the links still resolve. | Closes the gap to PRD Stage 2 and to the baseline without new web access. Backlog item 6 is the larger version. | 1–2 days, Claude |
| 6 | Richer feedback into revision: reason pills (no results, too broad, wrong function, wrong level, not climate) and an optional paste of result titles. | A thumb is one bit. Pasted titles are the only view of board output the model can have within the constraints. | 1–2 days, Claude |
| 7 | Write the pilot protocol into the 3.4 kit: moderated think-aloud, both arms per fellow in alternating order, blind rating of pooled fields, consented sharing of the exported profile, a check-in at day 7. | At 5–8 fellows, observation and field-level ratings carry the evidence. A feedback form alone will not show where the flow broke. | Half a day to design, about 90 minutes per fellow |
| 8 | Add a per-field label on the board: new to me, already considering, not for me, with a reason on reject. | Gives the novelty measure and a negative signal the app can use later. | Half to one day, Claude |
| 9 | Ask country or region up front if any pilot fellow is outside the US. Audit the catalogue and employer names for US skew. | Location became a board filter in D36, so discovery can suggest fields and employers that do not hire where the fellow lives. | Half a day plus catalogue work |

### P2: after the first sessions

| # | What to do | Why | Effort |
| --- | --- | --- | --- |
| 10 | Shorten the time to the first board. Stream fields as they arrive, or move a question into the 65-second wait. | The PRD asks for value before forms. Today cards, three questions and the wait all come first. | 1–2 days, Claude |
| 11 | Let the board move: a "show different fields" action that uses rejects. Make each per-field ask change something visible, or remove it. | A one-shot board leaves a fellow who rejects most of it with nowhere to go. Re-ranking on an answer is out of 2b (D43). | 2–3 days, Claude |

## Appendix A: UX walk-through

The flow is coherent, but the user reviews cards, answers three questions and waits about 65 seconds before seeing a field, and has few ways to talk back after. The table follows the Phase 2b screens in order.

| Screen | What works | Risk | Suggestion |
| --- | --- | --- | --- |
| First run (paste, notes) | Paste is low friction. Notes feed preferences. | A resume under-reports what drives a sector move: volunteer work, side projects, motives, things the person will not do. | Prompt for those in the notes box. |
| Highlights (cards) | Seeing what the model thinks of you builds trust. Edit and Exclude give control. | Review load before any value: several cards, each with situation, actions, results and skills. Fellows may confirm without reading, which makes "confirmed" meaningless. Resumes rarely state situation or results, so the model must infer them. | Mark inferred parts as inferred. Measure edit rate and time on screen. |
| Three questions (pills) | One at a time, fast. | All three come before any result. Appetite for retraining is hard to judge in the abstract. | Ask it later, on a concrete stretch field. The per-field ask is the right place. |
| Pending | Discovery now finishes: 226s down to 65s (2b.7). | About 65 seconds of dead time at the moment of highest curiosity. | Item 10. |
| Field board | Ranked options with fit level, summary and evidence read as choices, not verdicts. | One shot. Rank and fit level imply a precision nobody has measured. No way to ask "why not X?". | Items 8 and 11. |
| Expanded card | Roles, employers and one uncertainty. Ticking roles gives control over search scope. | No example post or day-to-day since D39, so titles stay abstract. An ask whose answer changes nothing visible (D43). | Item 5. |
| Searches | Per board, copy buttons, alert steps. | The fellow leaves for three other sites here. This is the likeliest drop-off, and the loop depends on them coming back. | Lead with one board. Offer a link that opens the board with the query filled in, which the user clicks. |
| Feedback and revision | Accept or keep the old query keeps the user in charge. | Binary rating. One rating can change queries, fields and profile, a large update from a thin signal. | Item 6. Show everything that changed, not only the query. |
| Return visit | The profile persists in the browser and exports. | Alerts pay off days later, but "alpha done" ends in one sitting. Browser storage does not follow the fellow to another device. | Prompt an export at session end. Item 7's day-7 check-in. |

### On leaving out the composer

I would keep the composer out for the pilot (D42). It makes the comparison with a chat assistant clean and it bounds cost. The price is that the PRD's "conversational input" is now pills, a notes box and an edit form. In each moderated session, note every moment the fellow wants to type something. That list is the evidence for backlog item 2.

### Three questions to answer in every session

1. Does the fellow believe the fit reasoning, and which evidence line convinces or loses them?
2. Do they leave knowing a field or title they did not know before?
3. Where do they want to push back, and can they?

## Appendix B: how the suggestions are populated

The pipeline grounds everything in the user's own words, but nothing grounds it in the labour market. The table shows what each model call sees and what code does and does not guarantee.

| Step | Model sees | Code guarantees | Not guaranteed |
| --- | --- | --- | --- |
| Cards | Pasted text | Each card has situation, actions, results and a skill | That the card is faithful to the text. Inferred results can be invented. |
| Discovery | Cards, preferences, the catalogue (30 fields, 89 role profiles, 65 example posts). No web. | Every field and role cites a card. Links come only from the catalogue. | That the cited card supports the claim. Fit level. Attainability. Currency of anything from model memory. |
| Queries | Profile and ticked roles for one field. No web, no catalogue. | Three queries, one per board, one field | That the syntax suits the board, that results exist, that they fit |
| Revision | Profile and a good or bad rating | The user can keep the old query | That the revision is better, or addresses the actual problem |

### B1. Cards launder inference into evidence

Every later claim must trace to a card, so a card error becomes "grounded". Resumes are bullet lists, not situation, action, result. The model fills the gaps. A cheap code check: every number and named organisation in a card must appear in the pasted text.

### B2. The citation check tests form, not truth

A field that cites card C2 passes whether or not C2 supports it. This is the PRD's own warning: a convincing explanation of fit is not enough. A stronger signal is available from data you already hold. Compare the requirements in the catalogue's example posts and role profiles with the cards, and show which are met and which are missing. That is fit sourced from postings, and it names the gap.

### B3. Catalogue coverage is thin by function

The catalogue has 30 fields and 22 functions, so 660 field and function pairs. With 89 role profiles, under 14% of pairs can have one, about 3 roles per field. A videographer or an accountant will often land where the catalogue has no role, so their roles come from model memory with no source. Expect non-technical profiles to see less evidence than technical ones. Measure the sourced share by function before the pilot.

### B4. Anchoring, popularity and flattery

Three predictable biases, each with a cheap test in Appendix C.

- **Anchoring.** The model will likely favour the 30 fields it is shown, so the catalogue's gaps become the product's gaps. Compare the 30 against an outside taxonomy, such as Climatebase's own sector list.
- **Popularity.** The same few fields may top every board regardless of profile.
- **Flattery.** Fit levels are likely to skew high. A model rarely tells a user they are a poor fit.

### B5. Stability is unmeasured

If the same profile yields a different board on a second run, the ranking carries little information. The plan records cost and latency per run but not variance.

### B6. Queries are written blind

This is the weakest link in the chain, for three reasons.

- **No real title vocabulary.** The query writer does not see the example posts, the one place real titles live. Titles reach it only second hand, through the roles discovery named.
- **Boards differ.** LinkedIn and Indeed accept quoted phrases and Boolean operators. A small specialist board holds far fewer posts, so a narrow keyword string can return nothing. Check whether Climatebase is better served by filter choices than by keywords.
- **LinkedIn's pull toward the current profile.** The PRD's opening complaint is that climate keywords still returned roles like the user's current one. Keyword queries alone may hit the same wall. Test this first on your own case in G2b.1.

### B7. Revision learns from one bit

A bad-fit rating does not separate "no results" from "wrong level" from "not climate". Yet the plan says it revises queries, fields and profile. The profile is the user's confirmed record, so a thumb should not rewrite it silently.

### B8. Employers and staleness

Employers are the most actionable output and the most perishable. Climate startups close and merge often, and model memory has a cutoff. Hand-check a sample of 50 named employers: does it exist, is it in this field, is it hiring in the fellow's region? Many example post links gathered in September will likely have expired by the pilot.

### B9. The eval plan has a closed loop

- **Synthetic profiles, same-family judge.** Model-written resumes are cleaner than real ones, and the judge shares the generator's blind spots. Add two or three real, consented, messy resumes.
- **"Sources real" passes by construction.** Code already restricts links to the catalogue. The rubric lacks plausibility, novelty, stability and board results.
- **The baseline is weaker than the PRD specifies.** The PRD lets the assistant ask questions within the same time budget. Step 3.2 gives it a profile and saves a transcript. A one-shot baseline will overstate the app's edge.

## Appendix C: validating each step

Each step gets an offline check you can run before the pilot, a signal to collect during it, and a red flag that means stop and fix. None of the offline checks needs an LLM judge.

| Step | Offline check | Pilot signal | Red flag |
| --- | --- | --- | --- |
| Cards | Code: every number and organisation in a card appears in the paste. Count resume roles with no card. Hand-read 10 cards for inflated skills. | Edits and exclusions per card. Ask aloud: "is this you?" | An invented result. No edits from any fellow. |
| Preferences | Flip one answer and rerun. Low appetite for retraining should mean fewer roles outside the user's function. | Use of "Change an answer". Hesitation on a pill. | An answer that leaves the board unchanged. |
| Discovery | Same profile five times: overlap of the top five fields. Different profiles: overlap should be low. Exclude a card: fields citing only it should drop. Fit-level spread. Sourced share by function. | Each field labelled new, known or not for me. Acceptance by fit level. Fields the baseline or the fellow named that the app missed. | The same top fields for every profile. Nearly all fields at the top fit level. Boards that change run to run. |
| Expanded card | Share of roles in the user's own function. 50 employers checked by hand. Whether the uncertainty text repeats across fields. | Roles ticked per expanded field. Whether the fellow looks up an employer. | A defunct employer. The same uncertainty on every card. |
| Queries | By hand on each board: result count and fits in the first 10. Same for the baseline's queries. | Good-fit rate on the first try. Alerts actually set. | Queries with no results. LinkedIn returning the fellow's current kind of job. |
| Revision | Scripted rating with a reason, then rerun old and new query by hand and compare fits in the first 10. | Accept versus keep-the-old rate. Fit after versus before. | Fellows mostly keep the old query. |
| Whole session | Time to first board, total time, cost per session (already logged). | "Alpha done" reached in one sitting. At day 7: alerts kept, relevant posts seen, any application or conversation. | The baseline matches on new and plausible fields in less time. |

### Pilot design for 5–8 fellows

1. **One moderated call of about 90 minutes per fellow, both arms.** Alternate which arm comes first. The baseline is the same model with web search, a prompt fixed in advance, the same time budget, and free to ask questions.
2. **Blind field ratings.** Pool the fields from both arms, remove which arm produced them, and have the fellow rate each: new or known, plausible or not, would pursue or not. This yields many judgments per fellow instead of one opinion per arm.
3. **Queries on a real board.** The fellow runs two queries from each arm on one board and counts fits in the first 10.
4. **Effort.** Record time and how much the fellow typed in each arm.
5. **The exported profile as the session record.** It already holds field statuses, ticked roles and query ratings. A fellow who chooses to share it gives you full session data with nothing stored server side.
6. **Day 7.** Three questions: which alerts did you keep, what relevant posts arrived, did you apply or contact anyone?

Order effects will remain at this sample size: whichever arm runs second benefits from the first. Report results by order and treat them as formative, as the PRD already says.

### Decision rule and judge calibration

Set both before the pilot; the thresholds below are starting suggestions.

- **Rule.** The guided flow earns further work if most fellows get at least as many new and plausible fields from it, and more fits in the first 10 results, in no more time. If the baseline matches it, the product is the prompt and the profile format, not the app.
- **Judge.** Label about 40 outputs by hand. Use the LLM judge only on rubric lines where it agrees with you at least 80% of the time.

## Appendix D: scope and open questions

This review rests on three documents only: PRD.md, PLAN.md and docs/data-flow.md. I did not read the code, the prompts, the catalogue, the technical plan or the design handoff, and I did not run the app.

### Not checked

- **Job board behaviour.** The points on LinkedIn, Indeed and Climatebase search come from general knowledge, not from a test. Item 3 is that test.
- **Cohort geography.** Item 9 assumes some fellows may be outside the US.
- **Effort estimates.** They are guesses made without seeing the code.

### Questions the three documents leave open

Each one changes the weight of a finding above. Most can be answered during your G2b.1 run.

1. Do employer names come from the catalogue or from model memory? (B8, item 5)
2. What happens to the board when a field is rejected? Does anything replace it? (item 11)
3. Does answering a per-field ask change anything the user can see? (item 11)
4. Does "keep the old one" also undo the field and profile changes from that revision? (B7)
5. How were the 30 fields chosen, and who reviewed them? (B4)
6. Do cards show which parts were stated in the resume and which were inferred? (B1)
7. Do the Searches screens open a board with the query filled in, or copy only? (Appendix A)
8. What are the fit levels, and do they map to the PRD's three kinds of move: sector move, adjacent role, retraining? (B2)
