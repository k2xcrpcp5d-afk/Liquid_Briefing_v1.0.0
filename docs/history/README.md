# Liquid Briefing – Milestone 2: how the workflow works

This README explains what the workflow does and which part does what. For import, credentials, switches and the test procedure, see `SETUP.md`.

## In one paragraph

One article goes in. A model extracts factual claims, and each claim must come with a quote copied word for word from the article. Code, not the model, then checks every claim against that quote: is the quote really in the article, and do the numbers, unit, period, comparison basis, direction and estimate-vs-actual match? Only claims that pass become spoken sentences. A second gate re-checks the finished script line by line. If anything fails, the workflow **stops before text-to-speech**. If everything passes, ElevenLabs reads the script, and the output pairs the MP3 with a transcript in which every factual sentence links to the article it came from.

## The flow

```
 Manual Trigger
      │
 ① Prepare article & request ──── CONFIG, fixture article, prompt, schema
      │
 ② Use mock LLM? ─────────────┐
      │ false                 │ true
 ③ OpenAI extract claims   ③' Mock extraction      (same output shape)
      │                       │
      └──────────┬────────────┘
 ④ Validate claims ───────────── checks each claim, logs tokens/cost
      │
 ⑤ Build script & gate ───────── writes script, final check — THROWS on failure
      │
 ⑥ Synthesize audio? ─────────┐
      │ true                  │ false
 ⑦ ElevenLabs TTS             │
      │                       │
      └──────────┬────────────┘
 ⑧ Package briefing ──────────── transcript + source links + MP3 + usage totals
```

There are two kinds of nodes:
- **Code nodes** (①, ③', ④, ⑤, ⑧) contain all the logic. Their source is also in `code/01–05_*.js`.
- **IF and HTTP nodes** (②, ③, ⑥, ⑦) only route or send requests. Nothing is decided in them.

## Node by node

### ① Prepare article & request — `code/01_prepare.js`

This node gets everything ready. Nothing else in the workflow has configuration.

| Section | What it does |
|---|---|
| `CONFIG` | Every switch: mock vs real LLM, audio on/off, `TEST_MODE`, model names, cost guard, listener profile, price table. Later nodes read it via `$('Prepare article & request').first().json.config` |
| `RAW_ROW` | The fictional input article, shaped like a Newstex JSONL line. **Replace this with a real row** once that's allowed |
| `pick`, `cleanText`, `normalizeUrl` | Turn the raw row into the `Article` record. `pick` tries several possible field names, because the real Newstex field paths are not yet confirmed. `normalizeUrl` removes tracking parameters |
| `cyrb53`, `contentHash` | Hash of the cleaned body, used later to find exact copies. It uses SHA-256 if the sandbox allows `crypto`, and falls back to `cyrb53` otherwise |
| Guards | Throw if there is no permalink (a claim without a source is useless) or the text is under 200 chars |
| `SYSTEM_PROMPT` | The extraction rules: one figure per claim, exact contiguous quote, keep qualifiers, keep "what happened / market move / who says why" apart, no advice, no URLs |
| `CLAIM_SCHEMA` | Strict JSON schema the model must return. One `event` plus a `claims[]` array. Each claim has an optional structured `figure` (value, unit, currency, period, basis, direction, actual/estimate/forecast) |
| `openai_body` | The complete Chat Completions request. The system prompt comes first so prompt caching can apply. `reasoning_effort` is sent only for reasoning models. No `temperature` |

**Output:** `run_id`, `started_at_ms`, `config`, `article`, `cache_key`, `openai_body`.

### ② Use mock LLM? — IF node

Checks `{{ $json.config.USE_MOCK_LLM }}`. If true, the run takes the free, deterministic path ③'. If false, it calls OpenAI through ③.

### ③ OpenAI extract claims — HTTP Request

Sends `openai_body` to `https://api.openai.com/v1/chat/completions` using the OpenAI credential, and retries up to 3 times. **Output:** the raw OpenAI response, including `usage`.

### ③' Mock extraction — `code/02_mock_extraction.js`

Returns a hand-written response with exactly the same shape as the real one: six claims c1–c6 about the fictional Norland producer-price release. Their token usage is zero. Node ④ can't tell the difference, which is the point.

### ④ Validate claims — `code/03_validate_claims.js`

This is the fact-checking node. It **never throws**. It records every problem on the claim and leaves the decision to ⑤.

| Section | What it does |
|---|---|
| Helpers | `norm` makes text comparable: lower case, straight quotes, plain dashes, collapsed spaces. `extractNumbers` pulls out numbers and times, treating "0,4" as 0.4 for German/Dutch, and marks years. `L` holds the EN/DE/NL keyword lists for comparison basis, direction, estimate wording, units, attribution, causality, advice and months |
| **1. Parse** | Reads the model's JSON. A refusal, cut-off output (`finish_reason: length`) or invalid JSON becomes `extraction_error` |
| **2. Fault injection** | Only when `TEST_MODE` is set. It deliberately breaks the model output (`bad_quote`, `wrong_basis`) to prove that the checks catch it |
| **3. Per-claim checks** | See the table below. Each claim gets `status: verified` or `rejected`, plus `errors[]` and `warnings[]`. Here **code** attaches `claim_id`, `story_id`, `source_article_id` and `source_url`; the model never supplies IDs or links |
| **4. Usage log** | One row with input, cached, output and reasoning tokens, and cost from the price table: `(uncached input × input price + cached × cached price + output × output price) / 1M` |

What the per-claim checks test:

| Check | Question it answers |
|---|---|
| Evidence | Is the quote an exact passage of the article, not paraphrased, not shortened with "…"? |
| Numbers | Is every number and time in the sentence actually in the quote, and is the key figure stated? |
| Period | If the sentence names a month, is it the same month the quote names? |
| Unit / currency | Percent, percentage points, basis points or currency — present in both quote and sentence, and not mixed up? |
| Comparison basis | Month-on-month, year-on-year, quarter-on-quarter, year-to-date, intraday or close: stated in both, with no conflicting basis? |
| Direction | Do "rose" and "fell" match the figure and the quote? |
| Estimate vs actual | Is an expectation clearly marked as an expectation, and not blended with the actual figure? |
| Attribution | Do views and forecasts name who said them? |
| Causality | Is any "because / driven by / amid" wording only used as someone's attributed view? |
| Advice | Any buy/sell/recommend/price-target/Zacks Rank wording? |

**Output:** `extraction_error`, `injected_faults`, `story` (the Story record), `counts`, `claims[]` (the Claim records), `usage_log[]`.

### ⑤ Build script & gate — `code/04_script_and_gate.js`

This node turns verified claims into a script and makes the final go/no-go decision.

| Section | What it does |
|---|---|
| `toSpoken` | Formatting for the ear only: "0.4%" becomes "0.4 percent", "m/m" becomes "month on month". It must never change a digit, and the gate checks that |
| **1. Select under the time budget** | Budget = `PROFILE.duration_seconds × 2.5 words`. It builds an intro (date plus AI-voice disclosure) and a transition naming the publication. Then it adds verified claims in the model's order (most newsworthy first) until the budget runs out, and ends with an outro (sources available, not investment advice). Every segment has `display_text`, `spoken_text` and `claim_ids` |
| **2. Final gate** | Checks the **script**, not just the claims. Every factual segment must cite verified claim IDs, and its numbers and times must appear in those claims' quotes. No advice wording. No unattributed causal wording. Template segments may not contain numbers (only the intro may hold the date). Spoken text keeps the same digits. The script stays under `MAX_TTS_CHARS`. A voice ID must be set if audio is on. When `BLOCK_ON_ANY_REJECTED_CLAIM` is on, any rejected claim also blocks |
| Block | If any issue is found, it throws `TTS BLOCKED – …` with a `REPORT {…}` listing every issue and the usage log. Because a throw stops the whole execution, no misconfigured IF can ever pass unchecked text to ElevenLabs |
| **3. Approved output** | `script.segments`, `script.tts_text` (the only text that goes to TTS), `chars`, `words`, `est_duration_seconds`, and `tts.body = { text, model_id }` |

### ⑥ Synthesize audio? — IF node

Checks `{{ $json.tts.enabled }}`, which comes from `CONFIG.SYNTHESIZE_AUDIO`. If false, the run skips straight to ⑧ in text-only mode.

### ⑦ ElevenLabs TTS — HTTP Request

Sends `tts.body` to `/v1/text-to-speech/{voice_id}` with the `xi-api-key` header. The MP3 comes back as binary `audio`. This replaces the item's JSON, which is why ⑧ reads the script metadata back from ⑤ by name.

### ⑧ Package briefing — `code/05_package_output.js`

Builds what a player page needs.

| Section | What it does |
|---|---|
| Audio | Takes the MP3 binary, renames it `briefing_<run_id>.mp3`, and fails loudly if audio was expected but missing |
| Transcript | One entry per spoken segment: text, `claim_ids`, and `sources` (publication, headline, permalink). It is built from the same validated segments that were spoken |
| Usage | Adds the TTS row (billable characters × credits per character for the chosen model) and totals: tokens, cost estimate in USD, credits, elapsed time |

**Output:**

| Field | Audience |
|---|---|
| `briefing` (disclosure, duration, audio, transcript) | Listener-facing |
| `claims_public` (statement, status, link) | Listener-facing |
| `debug_internal` (evidence quotes, check results, `tts_text`) | Team only — never show it in the player, because it contains licensed text |
| `usage` | Cost report |
| binary `audio` | The MP3 |

## How data maps to the record contracts

| Contract | Created in | Where |
|---|---|---|
| Article | ① | `$json.article` (`text_content` is internal) |
| Claim | ④ | `claims[]`: `claim_id, story_id, statement, source_article_id, source_url, figure, status`, plus `internal.evidence_quote/evidence_location` |
| Story | ④ | `story` (one article = one story in M2; `editorial_score` is still null) |
| AudioSegment | ⑤ | `script.segments[]`: `spoken_text, claim_ids[]` (no timestamps yet) |
| ListenerProfile | ① | `CONFIG.PROFILE` (fixed preset in M2) |

## Where to change what

| You want to… | Edit |
|---|---|
| Test a different article | `RAW_ROW` in ① |
| Change extraction behaviour | `SYSTEM_PROMPT` / `CLAIM_SCHEMA` in ①, and bump `PROMPT_VERSION` |
| Fix a false rejection on real text | Keyword lists `L` in ④ (and the matching `ADVICE`/`CAUSAL` in ⑤) |
| Change the intro or outro wording | Templates in section 1 of ⑤ |
| Change length or pacing | `PROFILE.duration_seconds` in ①, `WORDS_PER_SECOND` in ⑤ |
| Switch model or voice | `CONFIG` in ①, and add the new model's prices |

## Known quirks

- **Duplicated helpers.** `norm`, `extractNumbers`, and the advice and causality patterns exist in both ④ and ⑤, because Code nodes can't share files. Change them in both places.
- **Node names are references.** ④, ⑤ and ⑧ look up earlier nodes by name. If you rename a node, update every `$('…')` call that uses it.
- **No caching yet.** Every run calls OpenAI again. `cache_key` (content hash, prompt version, model) is computed but nothing reads it yet. That comes with the Workflow A split.

## How this grows into the full architecture

- ①–④ become **Workflow A** (process each article once). It loops over the snapshot, adds dedup and event grouping before ③, and stores stories and claims in `stories.json` or a Data Table.
- ⑤–⑧ become **Workflow B** (one run per listener). It loads stored stories, ranks them per profile, and can later let an LLM write the script. The ⑤ gate stays as the safety net.
