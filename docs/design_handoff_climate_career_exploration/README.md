# Handoff: Climate Career Exploration

## Overview
A single-page web tool that takes a person's resume/bio, extracts their work highlights, and matches them to climate fields they could plausibly move into. The output the user actually leaves with is a set of **job-board search queries** built from the roles they ticked, plus a feedback loop that revises those queries.

The product spine is a **field board** (ranked cards of climate fields). Chat is a right rail, not the main surface: it is absent at kickoff and appears when the assistant has a question or is working. There are no top-level tabs — Fields is the board, Queries is a per-field view reached from a card, and Profile is a drawer opened from the rail.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, native, etc.) using its established patterns, component library, and styling approach. If no codebase exists yet, choose the most appropriate framework and implement the designs there.

The prototype is authored in a custom HTML component runtime (`support.js`). Do not port that runtime. Read `Climate Career Exploration.dc.html` as a spec: the markup shows structure and inline styling; the `<script data-dc-script>` block at the bottom holds the data model, state, and style helper functions. All of it maps cleanly onto a React component with local state.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interaction states are final. Recreate the UI pixel-faithfully using the codebase's existing libraries where they cover the same primitives (buttons, chips, textareas, cards); match the values in the Design Tokens section where they don't.

Not final / out of scope in the prototype:
- No backend. Matching, log lines, and query revision are hard-coded sample data.
- No real clipboard, export/import, or delete behavior on the profile drawer.
- Mobile/responsive layout not designed. Grids use `auto-fill` so they degrade gracefully, but the 352px rail and the sticky state bar assume desktop width.
- The dev "State" bar at the very top is a **prototype-only screen switcher**. Do not ship it.

## Screens / Views

All screens live inside one app shell. `screen` state drives which main panel renders.

### Shell (always present)
- **Outer page**: background `#eceeec`, `min-height: 100vh`, bottom padding 48px. Font stack `'Instrument Sans', Helvetica, sans-serif`, text `#10201a`.
- **Prototype state bar** (remove in production): sticky top, `#10201a` bg, chips for each of the 7 screens, plus a "Hide chat rail" toggle on the right.
- **Card container**: `max-width: 1440px`, centered, 20px side padding. Inner panel `background: #f7f8f7`, `border: 1px solid #dde2df`, `border-radius: 14px`, `overflow: clip`, `box-shadow: 0 1px 2px rgba(16,32,26,.05)`.
- **Header**: 14px/20px padding, white bg, bottom border `#e2e6e3`. Contains a 22×22 `#12603f` rounded square mark (radius 6), product name at 15px/700/`-.01em`, an "Alpha" badge (IBM Plex Mono 10px, uppercase, `.08em` tracking, `#12603f` on `#e8f2ed`, radius 4, padding 3/6), and a 3-step nav: "1 Highlights", "2 Fields", "3 Searches". Nav is hidden on First run.
  - Step button, active: bg `#e8f2ed`, border `1px solid #cfe3d8`, color `#12603f`, weight 600. Inactive: transparent bg, transparent border, color `#5c6b64`, weight 400. Radius 7, padding 6/10, 13px.
  - "2 Fields" is active for board/explored/pending; "3 Searches" is active for queries/feedback.
- **Body grid**: `grid-template-columns: minmax(0, 1fr) 352px` when the rail is open, `minmax(0, 1fr)` when closed. `min-height: 620px`. Main pane padding `22px 24px 32px`.
- **Profile drawer** (collapsible, between header and body): dark panel `#10201a`, text `#dfe8e3`. Title "Your profile" 14px/700; subtitle "Stored on this device only. Never on a server." 12.5px `#8aa79a`; a circular italic "i" info toggle; right-aligned buttons "Export .txt" (filled `#12603f`), "Import" (outline `#35473f`), "Delete everything" (outline `#6b3a34`, text `#f0b7ae`). Below: a monospace `<pre>` of profile.txt, 12px/1.7, color `#b9c9c1`, `max-height: 190px`, scrollable. Toggling the "i" reveals a privacy paragraph with a 2px left rule `#35473f`.

### 1. First run (`firstRun`)
**Purpose**: paste a resume and start.
- Centered column, `max-width: 620px`, `margin: 28px auto 0`. Rail is hidden on this screen.
- H1 30px/1.15, `-.02em`: “Start from what you have done, not from the word “climate”.”
- Sub 15.5px/1.6 `#43544c`: “Paste your resume or bio. See climate fields your experience could open up, and the searches to run on job boards.”
- Card: white, border `#dde2df`, radius 12, padding 14. Contains a borderless resume textarea (`min-height: 176px`, 14.5px/1.6, placeholder “Paste your resume or bio…”), a divider, a smaller notes textarea (`min-height: 62px`, 13.5px, placeholder “Notes: constraints, interests, what you don't want. Optional.”), then a divider and a **Start** button (filled `#12603f`, radius 8, padding 10/16, 14px/600) with the note “About a minute. You can correct everything after.” at 12.5px `#5c6b64`.
- Footer link (opens the profile drawer): “No account, nothing stored.”

### 2. Highlights (`confirm`)
**Purpose**: correct the extracted work highlights and exclude ones not to match on.
- Header row: H2 21px `-.015em` “Your highlights”; sub 13.5px `#5c6b64` “Fix anything wrong. Exclude what you do not want to be matched on.”; right-aligned counter pill in IBM Plex Mono 11.5px, `#12603f` on `#e8f2ed`, border `#cfe3d8`, radius 8, padding 8/11 — “Matching fields · 5 of 6 in”.
- Grid: `repeat(auto-fill, minmax(320px, 1fr))`, gap 14, top margin 18.
- **Highlight card**: white, border `#dde2df`, radius 14, padding `16px 16px 14px`, shadow `0 1px 2px rgba(16,32,26,.04)`. Excluded cards drop to `opacity: .5` and border `#e7ebe8`.
  - Title 14.5px/700, years right-aligned in mono 11px `#5c6b64`.
  - A `<dl>` with `grid-template-columns: 62px minmax(0,1fr)`, gap `6px 10px`. Labels SITUATION / ACTION / RESULT in mono 10.5px uppercase `.06em` `#8a9790`; values 13.5px/1.55 `#33443c`.
  - Skill chips: 12px, `#33443c` on `#eff2f0`, radius 6, padding 4/8, gap 6.
  - Footer row above a `#eceeec` top rule: "Edit" (outline `#cfd8d3`, radius 7, 12.5px) and "Exclude" / "Excluded — include" toggle.

### 3. Field board (`board`) — the primary screen
**Purpose**: read ranked climate fields, mark interest, open one to see roles.
- Header: H2 “Climate fields worth a look”, sub “Click on a card to see more info and roles.”
- Grid: `repeat(auto-fill, minmax(330px, 1fr))`, gap 16, `align-items: start`.
- **Field card** (collapsed): white, border `#dde2df` (`#cfe3d8` when open), radius 14, shadow `0 1px 2px rgba(16,32,26,.04)` (`0 4px 18px rgba(16,32,26,.09)` when open), `transition: box-shadow 160ms ease, opacity 160ms ease`. Cards marked "Not for me" render at `opacity: .55`.
  - Top row: rank badge (mono 11px, `#12603f` on `#e8f2ed`, radius 6, padding 4/7); field name 16px/600 `-.015em`/1.3; sector line 13px `#5c6b64`; right-aligned expand button labelled **See Roles** / **Close** (12.5px/600 `#12603f` on `#e8f2ed`, border `#cfe3d8`, radius 7, padding 5/9).
  - Meta row, 13px: a move-type dot (8×8, radius 2 — Sector move `#12603f`, Adjacent role `#4fbf8b`, Retraining `#c99a3e`) with its label at weight 500; then a fit bar — 44×6, radius 3, `linear-gradient(to right, #12603f <fit%>, #e7ebe8 <fit%>)` — with the fit label ("Strong overlap" / "Some overlap" / "Stretch").
  - Blurb 13.5px/1.6 `#33443c`, then chips (same style as skill chips).
  - Footer: 3-column grid, gap 8, top rule `#eceeec`, padding `14px 18px 18px` — **Interesting / Unsure / Not for me**. Inactive: white, border `#dde2df`, color `#5c6b64`, weight 500. Active tones: yes `#12603f` on `#e8f2ed` border `#cfe3d8`; unsure `#8a5a00` on `#fbf1dd` border `#efdfbd`; no `#4a5b53` on `#eff2f0` border `#dde2df`. Radius 8, padding `8px 6px`, 12.5px, weight 600 when active. Clicking the active mark clears it.

**Ordering rule (important):** cards sort Interesting → Unsure → unmarked → Not for me, but the sort is **resolved only on arrival at the board**, not live. Cards must not jump out from under the cursor while the user is marking. Store a snapshot order when the user navigates onto the board and re-sort on next entry.

### 4. Field explored (`explored`) — a field card expanded in place
Clicking the card body (or the See Roles button) expands it. The expanded card takes `grid-column: 1 / -1` (full width of the grid). Inside a 16px top margin and a `#eceeec` top rule:
- **From your highlights**: mono uppercase 10.5px `.07em` `#8a9790` label, then evidence rows — a 5×5 `#12603f` dot (radius 50%, `margin-top: 7px`) beside 13.5px/1.55 text of the form **`<highlight title>`** — `<why it transfers>`.
- Two-column area, `repeat(auto-fit, minmax(290px, 1fr))`, gap 12:
  - **Roles to look at** (bg `#f7f8f7`, border `#e2e6e3`, radius 10, padding 12/13): label, sub “Select the ones you want searches for.”, then a vertical list of checkbox buttons. Unselected: white, border `#dde2df`, color `#33443c`. Selected: `#e8f2ed`, border `#cfe3d8`, color `#12603f`, weight 600, with a ✓ in a 15×15 filled `#12603f` box (radius 4). Role clicks must `stopPropagation` so they don't collapse the card.
  - **What is uncertain** (white, border `#efdfbd`, radius 10): label in `#8a5a00`, the uncertainty sentence, then a button whose label depends on state — “Add info in chat” → “Open in the chat rail” (while that field's ask is live) → “Noted — in profile.txt” (after the user answers). Clicking it opens the rail and loads that field's question.
- **Potential employers**: mono label + outlined name chips (white, border `#e2e6e3`, radius 6, 12.5px).
- **Sources**: mono label + text links (12.5px, `#12603f`). Toggleable via the `showSources` flag.
- **CTA row**: filled `#12603f` button — “Get searches for these roles”, or “Select a role first” when nothing is ticked (click is a no-op then) — plus a selection note (“2 roles selected” / “Tick the roles you want searched.”).

### 5. Pending turn (`pending`)
The board while the assistant is still producing fields.
- A status strip above the grid: white, border `#cfe3d8`, **left border 3px `#12603f`**, radius 10, padding 12/14. A 15×15 spinner (2px ring, `#cfe3d8` with `border-top-color: #12603f`, `animation: spin 900ms linear infinite`), "Two more fields · ~90 sec left" 13.5px/600, "Nothing to do until this finishes." 12.5px `#5c6b64`, and a right-aligned "Watch it work" button that opens the rail.
- A **skeleton card** as the first grid item: white, `1px dashed #cfd8d3`, radius 14, padding 18, `animation: shimmer 1.6s ease-in-out infinite` (opacity .45 → 1 → .45). Grey bars (`#e7ebe8` / `#eef1ef`, radius 4) at 15px/62%, 11px/40%, then three 10px lines. Footer line in mono 11px `#8a9790`: “weighing 4 highlights against field 7 of 9…”.
- The rail shows a live log (see Rail below).

### 6. Query list (`queries`)
**Purpose**: hand over copy-pasteable job-board searches.
- Header: H2 “Searches to run”; sub “Built from the roles you selected, grouped by field. Copy one, run it in your own tab, then tell us how it went.” plus a circular italic "i" toggle revealing: “One search per field, never across fields. Job boards rank results with matching models that expect a coherent role profile, so a query mixing unrelated fields scores badly on all of them and buries the good postings.” Right-aligned “Back to fields” outline button.
- **Empty state** (no roles ticked anywhere): dashed white card, `max-width: 560px` — “No roles selected yet” + “Open a field, tick the roles that interest you, and the searches for them appear here.” + a filled “Back to fields” button.
- **Per field group** (`margin-top: 22px`): rank badge + field name (15.5px/600), then a “Selected roles” mono label with the ticked titles as `#12603f`/`#e8f2ed` chips, indented `margin-left: 34px`.
- **Query cards**: grid `repeat(auto-fill, minmax(340px, 1fr))`, gap 14. White, border `#dde2df`, radius 14, padding `16px 16px 14px`.
  - Head: board dot (8×8 radius 2 — Climatebase `#4fbf8b`, others `#12603f`), board name 14.5px/700, right-aligned mono note (e.g. “supports quoted phrases”).
  - Query block: mono 12.5px/1.65 on `#f5f7f6`, border `#e7ebe8`, radius 9, padding 11/12, `word-break: break-word`.
  - Actions: “Copy query” (filled `#12603f`; becomes “Copied”, `#12603f` on `#e8f2ed` with border `#cfe3d8`) and an “Open <Board>” outline link.
  - `<details>` “Turn it into an email alert” → ordered list of 3 board-specific steps, 13px/1.6.
  - Footer above a `#eceeec` rule: “Ran it?” + “Good results” / “Wrong results” outline buttons, both routing to the feedback screen.

### 7. Post-search feedback (`feedback`)
`max-width: 660px`.
- H2 “How did that search go?”; sub line naming the board, query and timing: “Indeed · “interconnection study coordinator” OR “transmission planning analyst” · copied 6 min ago”.
- Card (white, border `#dde2df`, radius 14, padding 18):
  - Verdict row, `repeat(auto-fit, minmax(150px, 1fr))`, gap 8: **Good fit / Partly right / Wrong roles / No results**. Pill style, active = `#e8f2ed` / border `#cfe3d8` / `#12603f`; padding 10/12, 13.5px/600. Single-select.
  - “What was off?” multi-select chips: Too senior, Too junior, Wrong discipline, Wrong location, Needs a licence, Too few postings. Same pill style at 12.5px, padding 6/10.
  - Free-text textarea, placeholder “e.g. mostly utility engineering roles asking for a PE licence”, `min-height: 78px`, border `#dde2df`, radius 9.
  - Footer: filled “Send and revise” + “Revises the query, ranking and profile. ~2 min.”
- **Revised search card** below (white, border `#e2e6e3`, radius 12, padding 14/16): mono “Revised search” label, a right-aligned state note, an **editable** monospace textarea holding the revised query, then either the accept/reject pair (“Accept and use” filled / “Keep the old one” outline) or, once accepted, a confirmation line “Accepted. This replaces the Indeed search for this field.” in `#12603f` with a 7×7 square bullet.
  - State notes: proposed → “Proposed from your feedback. Edit it before accepting.”; edited → “Edited by you. Not applied yet.”; accepted → no note.
  - "Keep the old one" restores the previous query text and returns to the proposed state.

### Right rail — Assistant (352px)
Present on every screen except First run. `border-left: 1px solid #e2e6e3`, white. Its inner column is `position: sticky; top: 58px; max-height: calc(100vh - 74px)` with the message area scrolling.
- **Header**: “Assistant” 13.5px/700, padding 13/16, bottom rule `#eceeec`.
- **Your Profile row** (button, full width, bg `#f7f8f7`, hover `#eff2f0`): 7×7 `#12603f` square, title “Your Profile” 13px/600, sub “Everything known about you, kept on this device.” 11.5px `#5c6b64`, an "i" privacy toggle, and a right-aligned “Examine” / “Hide” link in `#12603f`/600. Opens the profile drawer in the shell.
- **Composer**: textarea (`min-height: 44px`, placeholder “Correct something, or ask why a field is here…”) + filled “Send”. Caption “For corrections and questions.” 11.5px `#8a9790`.
- **Working log** (pending only): `#f7f8f7` card, spinner + “Working · 2:14”, then timestamped lines (mono 10.5px time `#8a9790`, 12.5px text). The **last line is `#10201a`/600**, earlier lines `#5c6b64`. Footer: “Hold tight. Marking resumes when it lands.”
- **Ask card** (when a field's uncertainty was sent to chat): white, border `#efdfbd`, radius 11. Mono `#8a5a00` label “More on this field”, the field name, the uncertainty context, the question + “Optional — it sharpens the ranking.”, a draft textarea, then “Add to profile.txt” (disabled grey `#c3cdc8` until the draft is non-empty) and “Not now”.
- **Added to profile.txt** card: `#f7f8f7`, border `#cfe3d8`; mono `#12603f` label, the appended lines in mono 11.5px, and an “Open profile” button.
- **Messages**: per-screen scripted transcript. "You" bubbles `#f7f8f7`/border `#eceeec`; assistant bubbles white/border `#e2e6e3`. Radius 11, padding 11/12, `margin-bottom: 10`. Speaker label in mono 10px uppercase `.07em` `#8a9790`. Some assistant messages carry quick-reply pills (white, border `#cfe3d8`, color `#12603f`, radius 7).

## Interactions & Behavior
- **Navigation**: header steps jump between Highlights / Fields / Searches. "Start" → Highlights. Field CTA → Searches (blocked when no roles ticked). Query feedback buttons → Post-search. "Send and revise" → Pending.
- **Card expand/collapse**: clicking a field card body toggles it. Only inner controls that shouldn't collapse it (role checkboxes, the uncertainty button, the CTA) stop propagation. An expanded card spans the full grid row.
- **Marking**: three-way toggle; clicking an active mark clears it. Marking a field "Not for me" dims it to `.55` opacity but leaves it in place until the user leaves and returns to the board.
- **Role selection** drives the query list: queries exist only for fields with ≥1 selected role, grouped by field and ordered by field rank.
- **Copy** sets a single `copied` query id (label flips to "Copied"). In production, actually write to the clipboard and time the label out.
- **Uncertainty → profile**: "Add info in chat" opens the rail with that field's question. Submitting appends `"<profileKey>: <answer>"` to profile.txt, opens the profile drawer, clears the ask, and flips the field's button to “Noted — in profile.txt”.
- **Animations**: `spin` 900ms linear infinite (loading rings); `shimmer` 1.6s ease-in-out infinite (skeleton card); `box-shadow`/`opacity` 160ms ease on field cards. Nothing else animates.
- **Responsive**: all grids use `auto-fill`/`auto-fit` with min track widths (320/330/340/290/150px) and wrap. Below roughly 900px the 352px rail needs a design decision (drawer or bottom sheet) — not specified here.

## State Management
Single component's local state in the prototype; in production expect a screen router plus a session store.

| State | Type | Notes |
|---|---|---|
| `screen` | enum | `firstRun \| confirm \| board \| explored \| pending \| queries \| feedback` |
| `railOpen` | bool | forced closed on `firstRun` |
| `dataOpen` | bool | profile drawer |
| `privacyOpen` | bool | privacy note inside the drawer |
| `open` | map fieldId→bool | which field cards are expanded |
| `boardOrder` | fieldId[] | order snapshot, recomputed only on entering the board |
| `marks` | map fieldId→`yes\|unsure\|no\|null` | |
| `excluded` | map highlightId→bool | highlights not matched on |
| `selectedRoles` | map `"<fieldId>\|<roleTitle>"`→bool | drives the query list |
| `copied` | queryId or null | |
| `ask` | fieldId or null | live uncertainty question in the rail |
| `draft` | string | ask answer text |
| `profileAdds` | `{fieldId, line}[]` | appended profile.txt lines |
| `verdict` | enum | feedback verdict, single-select |
| `reasons` | map label→bool | feedback reasons, multi-select |
| `revised` / `revisedState` | string / `proposed\|edited\|accepted` | revised query card |

Data fetching a real implementation needs: resume → highlight extraction; highlights + profile → ranked fields with evidence, roles, employers, uncertainties, sources; selected roles → per-board query strings; feedback → revised query + re-ranked fields. The prototype fakes all four.

## Design Tokens

**Color**
| Token | Hex | Use |
|---|---|---|
| Page bg | `#eceeec` | app background, dividers |
| Panel bg | `#f7f8f7` | inner shell, subtle cards |
| Surface | `#ffffff` | cards, header, rail |
| Ink | `#10201a` | primary text, dark bars |
| Ink 2 | `#33443c` | body copy |
| Ink 3 | `#43544c` | lead paragraph |
| Muted | `#5c6b64` | secondary text |
| Muted 2 | `#8a9790` | mono labels, captions |
| Border | `#dde2df` | default card border |
| Border soft | `#e2e6e3` / `#e7ebe8` / `#eceeec` | inner rules, code block, dividers |
| Border strong | `#cfd8d3` | outline buttons |
| Green (primary) | `#12603f` | buttons, rank badges, accents |
| Green tint | `#e8f2ed` | active/selected backgrounds |
| Green border | `#cfe3d8` | active/selected borders |
| Green light | `#4fbf8b` | "Adjacent role" and Climatebase dots |
| Amber | `#c99a3e` | "Retraining" dot |
| Amber text | `#8a5a00` | uncertainty labels |
| Amber tint / border | `#fbf1dd` / `#efdfbd` | unsure + uncertainty surfaces |
| Neutral chip | `#eff2f0` | skill/topic chips, resolved state |
| On-dark text | `#dfe8e3` / `#b9c9c1` / `#8aa79a` | profile drawer + state bar |
| On-dark border | `#35473f` / `#4a5f55` | outline buttons on dark |
| Danger on dark | `#6b3a34` border / `#f0b7ae` text | "Delete everything" |
| Disabled | `#c3cdc8` | inactive filled button |
| Skeleton | `#e7ebe8` / `#eef1ef` | loading bars |

**Type** — Instrument Sans (400/500/600/700) for UI; IBM Plex Mono (400/500) for labels, timestamps, query text, profile.txt. Both from Google Fonts.

| Role | Size / line-height / weight / tracking |
|---|---|
| H1 (first run) | 30 / 1.15 / 400 / `-.02em` |
| H2 (screen title) | 21 / — / 400 / `-.015em` |
| H3 (query group) | 15.5 / — / 600 / `-.01em` |
| Card title | 16 / 1.3 / 600 / `-.015em` |
| Card title (small) | 14.5 / — / 600–700 |
| Body | 13.5 / 1.55–1.6 |
| Body large | 15.5 / 1.6 |
| Secondary | 12.5–13 / 1.5–1.6 |
| Mono label | 10.5 / uppercase / `.06–.07em` |
| Mono code | 12.5 / 1.65 |
| Caption | 11.5–12 |

**Spacing** — 4px base. Common: 4, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22. Grid gaps 8/12/14/16. Card padding 12–18. Main pane `22px 24px 32px`.

**Radius** — 2 (small square dots), 4 (skeleton bars, checkbox), 6 (chips, badges, small buttons), 7 (pill buttons), 8 (primary buttons, role rows), 9 (code blocks, textareas), 10–12 (inner cards), 14 (all main cards).

**Shadow** — resting `0 1px 2px rgba(16,32,26,.04)`; shell `0 1px 2px rgba(16,32,26,.05)`; expanded card `0 4px 18px rgba(16,32,26,.09)`.

## Assets
None. No images, no icon set. The only graphics are CSS shapes: the 22×22 brand square, 7–8px status dots and squares, the 44×6 gradient fit bar, the 15×15 checkbox, and the CSS spinner ring. Circular "i" info affordances are a literal italic "i" in a bordered circle. Text glyph used: `✓` in the role checkbox.

## Files
- `Climate Career Exploration.dc.html` — the full design. Markup (structure + inline styles) at the top; data model, state and style helpers in the `<script data-dc-script>` block at the bottom.
- `support.js` — the prototype runtime. **Reference only; do not port.** Required to open the HTML file in a browser (keep both in the same folder).

Sample content in the design — six climate fields, six resume highlights, three job boards, the chat transcripts, and the profile.txt body — is realistic placeholder data, not a fixed content spec.
