# Liquid Briefing – team handoff v2 (status: Fri 20 Nov 2026, 20:00 CET)

Give this whole file to your AI assistant before you work on the project. It is the single source of context: what exists, what is decided, what was measured in real runs, what is broken, and where to continue. Detailed docs per part: `README.md` (M2), `SETUP.md`, `README_WORKFLOW_A.md`, `README_WORKFLOW_B.md`.

---

## 0. TL;DR

- A working end-to-end pipeline runs in our n8n: **Newstex dataset → grouped stories → personal profile → story selection → claim extraction → LLM script → LLM fact check → ElevenLabs v4 Turbo audio → HTML page with player, transcript, source link per fact, "why you got this briefing" and cost**.
- Last real run: execution #13 of Workflow B, "what is happening to Jensen Huang, I don't know much".
  - Took 80 s, cost ≈ $0.06.
  - 7 factual sentences, all with sources; 2 removed by the fact checker.
- **Biggest open problems:**
  1. The script is still too much "fact, fact, fact" and too little podcast (no "so what", no transitions).
  2. The fact checker wrongly removes sentences that name the outlet ("according to Invezz").
  3. Claims with "million/billion" in the figure are wrongly rejected.
  4. Rules-only grouping still has a few false merges.
- **Deadline:** BuilderBase submission **Sat 21 Nov, 10:30 CET**. Required: project name, code matching the demo, 3-minute pitch video.

## 1. Challenge and goal

**Track:** Sourcera "The Liquid Briefing", MAIN Summit Hackathon Maastricht, 20–21 Nov 2026.

**Product:** a short, personal **audio** briefing from a day of financial news, where **every factual claim links to its source article**. Two listeners must hear clearly different briefings from the same feed: lead story, selection, depth, length. The jury gives a **live wildcard profile** and spot-checks spoken claims against their sources.

**Judging criteria:**
- Trust and accuracy – 25%
- Fit to the listener – 20%
- Making sense of the news (grouping, duplicates, facts) – 20%. The jury checks against its own answer key.
- Scalability and cost – 15%. We report the full-dataset cost and an estimate at 10× volume.
- Listening experience – 10%
- Path to product

**Demo plan:**
1. Play the openings of the briefings for listener A and listener B, same voice.
2. Generate the jury's wildcard live.
3. The jury clicks a claim's source link and checks it.
4. Show the cost slide.

## 2. Final decisions – do not change without team agreement

- **Stack:** n8n (JavaScript Code nodes + HTTP Request nodes), OpenAI `gpt-5-mini` (structured outputs, strict JSON schema), ElevenLabs. **No** Supabase, vector database or agent framework. Storage is **n8n Data Tables**.
- **English only** for script and audio. `profile.language` is always `en`.
- **Process once, reuse for everyone:** Workflow A groups once. Claims are extracted once per article and **cached** in `lb_claims`; the cache key is the article, its `content_hash` and `prompt_version`.
- **Facts never come from the model's memory.** The model extracts claims with an exact evidence quote. Code checks quote, numbers, unit, period, comparison basis, direction, estimate vs actual, attribution, causality and advice. **Only verified claims may be spoken.**
- **IDs and URLs are attached in code, never by the model.**
- **Fail-closed:**
  - "Build script & gate" throws `TTS BLOCKED` if any spoken segment fails the deterministic checks.
  - Writer segments that fail the checks are dropped *before* the gate.
  - The LLM fact checker can only remove sentences, never add them.
- **No investment advice.** The advice wording check runs on claims and on the script. User requests for tips are recorded in the profile trace and ignored.
- **Onboarding:** free text → **fixed profile**, via the LLM parser with a strict schema, falling back to keyword rules. Downstream nodes read only the profile. The voice always comes from a preset, never from user text.
- **Grouping is rules-based.** The optional LLM cluster check may only **split** clusters, never merge them.
- **Demo:** listener A and listener B use the **same voice** (`FORCE_VOICE_PRESET`), so the jury hears the editorial difference.
- **Licence:**
  - The data is for the hackathon only and must be deleted afterwards.
  - Never commit or republish article text: no dataset, no `text_content`, no evidence quotes in the repo, player or video. Short quotes and publisher links are allowed.
  - Processing through OpenAI and n8n is confirmed as allowed by Sourcera.

## 3. Live system (n8n project "BrainVO")

| Thing | ID / name | State |
|---|---|---|
| Workflow A – ingest & group | `So0NeN9PdrX9sHru` | Executed once (17:33). Tables filled |
| Workflow B – personal briefing (**current**) | `3aadxNqA5406Ut44` | Latest version: LLM writer, LLM verifier, Eleven v4 Turbo. 3 successful runs (#11–#13) |
| Workflow M2 – test bench (fictional article) | `T9t3jSdgWrpdw9kn` | Keep as is |
| Data Tables | `lb_stories`, `lb_articles`, `lb_claims` | Filled; `lb_claims` caches extractions |
| Credentials | "OpenAI account" (openAiApi), "Header Auth account" (name `xi-api-key`, ElevenLabs) | Already linked in B |

**n8n pitfalls we hit:**
- **"Import from File" into an open workflow ADDS the nodes; it does not replace them.** Always import into a new, empty workflow, then delete or archive the old one.
- Code nodes reference each other by name (`$('Select stories')`). If you rename a node, every reference breaks.
- Workflow setting *Binary mode* must be **separate**. It is preset in our JSON.
- `require('crypto')` is blocked in Code nodes. The code falls back to a non-cryptographic hash.

## 4. Pipeline in detail

### Workflow A – "load & group" (no LLM by default, ~7 s)

Form upload of the 6 `.jsonl` files → **Parse JSONL** → **Normalize, link & group**, which does the following:
- 919 articles before 12 Nov are kept as archive and not grouped.
- **Translations:** a DE/NL article is linked to the English Invezz article by the same author (`source`) that is nearest in time, within 15 min. 239 linked.
- **Exact copies:** detected by hashing the cleaned body.
- **Roundups** ("Evening digest", "5 things to know") are never used as a cluster anchor.
- **Similarity:** TF-IDF over headline (counted twice), excerpt and lead, plus named entities (taken from the excerpt when the headline is Title Case) and a coarse event type (legal / leadership / macro_data / central_bank / earnings / deal / market_move).
- **Clustering:** average-linkage, with a 36 h maximum span per cluster.

Optional: **LLM cluster check**, about 40 calls, which can only split clusters. Results are written to `lb_stories` and `lb_articles`; every run replaces the rows.
- **Result:** 413 event stories, 14 of them multi-outlet. **Our answer key passes 21/21.**

### Workflow B – "personal briefing" (28 nodes, ~80 s on the first run, faster with the cache)

1. **Listener onboarding** (form): "About you" free text, a Preset (`custom (use my text)` / `A_general_eu_90s` / `B_fx_markets_3min` / `W1_crypto_ai` / `W3_nvidia_holder`), and a Length in **seconds** (auto/60/90/120/180). **If a preset is chosen, the free text is ignored.**
2. **Build profile** → **OpenAI profile parser** → **Finalize profile**. Output: `profile{ listener_question, topics[], entities[], region, expertise, duration_seconds, tone, pace, focus (entities|topics), explain_terms, voice_preset }` plus a trace of which phrase set which field.
3. **Get stories / articles / claim cache** (Data Tables) → **Select stories**:
   - Only the last 48 h before **briefing date 19 Nov 06:00 UTC**.
   - Advice sections and roundups are excluded.
   - A story only qualifies for a topic if its **representative** article matches.
   - Company focus: "headline is about X" scores highest, recency counts.
   - Stories per length: 60 s → 3, 90 s → 4, 120 s → 5, 180 s → 7; beginners get one fewer.
   - Every decision is recorded with a reason.
4. **Build extraction requests** → **OpenAI extract claims**, only for chosen stories whose claims are not cached (`prompt_version: extract-v2`) → **Validate claims (batch)** → **Insert lb_claims**.
5. **Build writer request** → **OpenAI script writer**. It receives only verified claims and writes segments of kind `hook | story | bridge | explainer`, each with `claim_ids`.
6. **Check script & build verifier request** runs the deterministic checks per segment: cited claims are verified, every number appears in the cited evidence, no advice, no unattributed cause, no numbers in bridges or explainers. Failing segments are dropped. Then **OpenAI script verifier** judges each remaining segment against its claims and evidence; unsupported segments are dropped.
7. **Build script & gate** assembles the templated intro (including the AI-voice disclosure), the segments and the templated outro ("news, not investment advice"), then runs the final gate. If the writer fails, it falls back to the template script.
8. **ElevenLabs TTS:** `eleven_v4_turbo`. Voice presets: `neutral_news` = Bella `hpp4J3VqNfWAUOO0d1Us`, `calm_warm` = River `SAz9YHcvj6GT2YYXdXww`, `energetic` = Matilda `XrExE9yKIg1WjnnlVkGX`.
9. **Package briefing page** builds the HTML page and the MP3. **Show briefing** returns the page through the form. In n8n you can also download it from *Package briefing page* → Binary.

## 5. Data contracts

Arrays are stored as JSON strings in the Data Tables.

- `lb_stories`: `story_id, kind (event|roundup), title, first_seen, last_seen, outlets*, independent_outlet_count, article_count, article_ids*, translation_ids*, representative_article_id, entities*, provider_categories*, phase, editorial_score, storyline_id, check_status, check_label, split_from`
- `lb_articles`: `article_id, story_id, role (anchor|member|translation|exact_copy|roundup), feed, publication, permalink, language, published_at, headline, excerpt, author, provider_categories*, content_hash, translation_of, copy_of, text_len, text_content (internal only)`
- `lb_claims`: `article_id, story_id, content_hash, prompt_version, model, extraction_error, claims_json*, verified_count, rejected_count, input_tokens, cached_input_tokens, output_tokens, est_cost_usd, created_at`
- Claim: `claim_id, story_id, statement, claim_type (data_release|company_result|policy_decision|price_move|forecast_or_estimate|attributed_view|other_fact), attribution, source_article_id, source_url, publication, figure{value,value_text,unit,currency,period,comparison_basis,direction,measure}, status, errors[], warnings[], internal{evidence_quote, evidence_location}`

## 6. Measured in real runs (OpenAI gpt-5-mini, ElevenLabs v4 Turbo)

| Step | Tokens / characters | Cost | Time |
|---|---|---|---|
| Profile parse | 409 in / 715 out | ≈ $0.0015 | ~10 s |
| Claim extraction per article (uncached) | ~2,100–5,400 in / ~1,950 out (about half are reasoning tokens) | ≈ $0.004–0.005 | ~25 s, batched 5 in parallel |
| Script writer | 2,079 in / 1,161 out | ≈ $0.003 | ~20 s |
| Script fact check | 1,679 in / 836 out | ≈ $0.002 | ~25 s |
| TTS, 998 characters | ElevenLabs header `character-cost: 220` | ≈ $0.04 at list price ($0.04 / 1K chars) | <1 s |
| **One uncached 90 s briefing** | | **≈ $0.06** | ~80 s |

- With the cache, the next listener pays mainly for TTS plus writer and fact check (≈ $0.045).
- **Full snapshot extraction (estimate):** ≈ $4.9 for all 1,740 articles, ≈ $1.6 for the distinct articles since 13 Nov, ≈ $0.36 for one weekday window.
- **What drives cost:** TTS and script writing scale with the number of listeners. Extraction scales with news volume and is shared.

**Extraction quality in real runs:**
- Huang story: 6/6 claims verified.
- Huang statement story: 6/7. One rejected because the quote was not found verbatim.
- Huang family-trust story: 1/6. Wrongly rejected, see issue 3.
- Retail-sales story: 6/6.

## 7. Known issues – ordered by impact, with the fix location

1. **Script reads like a list, not a podcast.** In run #13: one fact per sentence, no "what does it mean", the only bridge is "Meanwhile".
   - Fix in `code/27_writer_request.js`, prompt section `CRAFT`:
     - require 2–3-sentence story blocks;
     - one context sentence per story built from claims (for example, combining "beat estimates" with "stock fell");
     - group by theme;
     - when the listener asked a question, answer it in the hook *and* close with one sentence that sums up the answer from claims.
   - Consider `reasoning_effort: 'medium'` for the writer only.
   - Compare outputs on the same 3 profiles.
2. **The verifier removes sentences that name the source outlet** ("according to Invezz").
   - Fix in `code/28_verifier_request.tmpl.js`: send each cited claim's `publication` to the verifier, and add to its prompt: "Naming the outlet that published the cited claim is allowed."
3. **Figures with scale words are wrongly rejected.** Example: `"nearly 59 million"` gives `figure_value_mismatch` and `figure_not_stated_in_statement`.
   - Fix in `code/03_validate_claims.js` → `extractNumbers` and the `value_text` comparison: handle `thousand|million|billion|trillion|bn|m|k` as multipliers. Also compare the statement number against `value_text` as written, not only `figure.value`.
   - Then rebuild B. Also bump `PROMPT_VERSION`, or clear `lb_claims`, so cached rejections are re-checked.
4. **False merges with rules-only grouping.**
   - Examples: "Dollar firms after retail sales" + Trump–Xi summit preview; Trump "AI national champions" inside the Huang story of 16 Nov.
   - Fix: turn on `USE_LLM_CLUSTER_CHECK` in Workflow A, re-run A, and compare against the answer key.
5. **Script length runs short:** 154 words / ≈ 62 s for a 90 s target. The writer is under target; tighten "target words" in the prompt, or compute the target per story.
6. **Untested:**
   - Eleven v4 Turbo voice settings: speed/style may be ignored. Listen to the MP3.
   - The *Show briefing* download in every browser.
   - The real LLM cluster-check quality.
7. **Only the representative article of each story is extracted.** There is no cross-outlet figure comparison or disagreement flag yet. Example from our answer key: PPI "core" is 0.5% vs 0.3% because of different definitions; it must be reported as two measures, not as a conflict.

## 8. Dataset facts (counted on the snapshot)

- **Feeds:** zacks 1,000 (71 since 13 Nov), ibtimes_uk 298, invezz_en 166, invezz_de 120, invezz_nl 120, actionforex 36. A weekday has 172–190 articles.
- **Fields:**
  - `publication.name` = outlet; `source` = author; `provider_categories` = publisher sections.
  - `categories` POSITIVE/NEGATIVE are unreliable – do not use them. `company_tickers` is rarely filled.
- **Answer-key events:**
  - **US PPI October** (ActionForex + Invezz): 0.3% m/m, 0.4% expected, 6.5% y/y.
  - **Intel shareholder lawsuit** (Invezz + IBTimes): $23bn offering. "29%" vs "28.6%" is rounding.
  - **Huang exit** (Invezz + IBTimes + Zacks), 13 Nov. "Huang open to return" on 17 Nov is a separate event (Invezz + IBTimes).
- **Must stay separate:** the PPI preview, the USD/JPY reaction, the 13 Nov chip selloff (it mentions PPI, Nvidia and Intel), "Intel falls Tuesday" (Nvidia stake cut) and the 16 Nov evening digest.

## 9. Code and how to change it

Repo/zip: `liquid-briefing-m2.zip`. **The dataset is never committed**; the local tests expect the JSONL files in `./data`.

| Path | What |
|---|---|
| `code/01–05_*.js` | M2 Code nodes. **Shared logic lives here:** extraction prompt and schema (`01`, region `<<EXTRACT_PROMPT`), claim checks `validateClaims()` (`03`, region `<<VALIDATE_CORE`), gate helpers (`04`, region `<<GATE_HELPERS`) |
| `code/09–13_*.js` | Workflow A |
| `code/20–28_*.js`, `*.tmpl.js` | Workflow B. The templates get the shared regions inserted at build time. **Never edit `*.built.js`** |
| `build_workflow.js`, `build_workflow_a.js`, `build_workflow_b.js [instance]` | Generate the importable JSON. `instance` = credentials pre-linked and audio on, for our n8n only |
| `harness.js`, `adversarial.js`, `grouptest.js`, `harnessA.js`, `harnessB.js` | Local tests without n8n. `harnessB.js` uses fake models |
| `answer_key.json`, `topic_map.json`, `dataset_profile.json` | Grouping answer key, topic → sections, dataset statistics |

**Change loop:**
1. Edit `code/*.js`.
2. `node build_workflow_b.js instance` (or a / m2).
3. Run the local tests (`node harness.js none`, `node adversarial.js`, `node grouptest.js`, `node harnessB.js "<text>" "custom (use my text)" 90`).
4. Import into a **new empty** workflow.
5. Delete the old one.
6. Run the same 3 profiles and compare the "why" pages.

**Small in-n8n edits are fine for quick tuning:** open the Code node and change a constant at the top (`CFG`, `WRITER`, `VERIFY`, `TTS_MODEL_ID`, `VOICE_PRESETS`, `SYNTHESIZE_AUDIO`). Then copy the change back into `code/` so the repo matches the demo.

**Editorial knobs (where your own values go):**
- What is relevant per topic, and what is never narrated or down-ranked: `TOPIC_MAP`, `ADVICE_SECTIONS`, `SOFT_NEWS` in *Select stories*.
- How much each factor weighs: the `score =` line in *Select stories*.
- Writing style: the `SYSTEM` and `STYLE` prompts in *Build writer request*.
- Intro and outro: `INTRO`/`OUTRO` in *Build script & gate*.
- Voices: `VOICE_PRESETS`.

## 10. Open tasks and suggested split

**Priority 1 (tonight):**
- Fix issues 1–3.
- Re-run profiles A, B and the Nvidia/Huang free-text profiles.
- Listen to the MP3s, then pick the demo voice and freeze the demo profiles.

**Priority 2:**
- Turn on the LLM cluster check in A and compare false merges.
- Measure the full-dataset extraction cost with a batch run, or document the estimate clearly.
- Build the cost slide: per briefing vs shared processing, and a ×10 scenario with articles ×10 and listeners fixed.

**Priority 3:**
- A clean player page for the demo (could reuse the HTML page).
- Pitch video (3 min): problem → buyer (publisher) → newsroom workflow → demo → trust mechanism → cost.
- Push to Git **without the dataset**.

**Suggested split:**
- Person 1: grouping / Workflow A, issue 4.
- Person 2: claim checks, issue 3 and the cross-outlet comparison.
- Person 3: selection, writer and voice, issues 1, 2 and 5.
- Person 4: page, cost report, pitch, submission.

## 11. Rules for AI assistants on this project

- Read this file first. Do not redesign the architecture; improve the marked places.
- Never weaken or delete a check to make output pass. Fix false rejections with a concrete example as evidence, and re-run `harness.js`, `adversarial.js` and `grouptest.js` afterwards.
- Edit the shared logic only in `01/03/04`, then rebuild. Never hand-edit `*.built.js` or the workflow JSON.
- Never output, commit or show article text or evidence quotes outside internal debug fields.
- English script and audio only. No investment advice, ever.
- Prices and model names change: verify them before quoting.
- If you change the extraction prompt or the claim checks, bump `PROMPT_VERSION` in `01_prepare.js` and in `22_select_stories.js`.
