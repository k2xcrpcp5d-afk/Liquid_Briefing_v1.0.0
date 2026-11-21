# Liquid Briefing – Milestone 2 setup

One article → OpenAI structured claim extraction → evidence and numeric checks → validated script → ElevenLabs → transcript with the original permalink.

This is one n8n workflow with 10 nodes and a sticky note. It has no database, no vector store and no agent framework. The input is a **fictional fixture**. Swap in real Newstex text only once you have confirmed that the event permits processing it through hosted n8n and the model APIs. n8n execution history stores the article text.

## Files

| File | Purpose |
|---|---|
| `liquid-briefing-m2.workflow.json` | Import into n8n (⋯ → Import from File, or paste onto the canvas) |
| `code/01_prepare.js` … `05_package_output.js` | The same Code-node logic as separate files, for review and diffs |
| `expected_output_happy_path.json` | What *Package briefing* returns in default mode |
| `expected_block_*.json` | The report each failure test throws |
| `harness.js`, `adversarial.js` | Run the Code nodes locally with `node harness.js <mode>` (no n8n needed) |

## Node chain

```
Manual Trigger
 → Prepare article & request      (Code)  CONFIG, fixture, normalize, prompt + schema, request body
 → Use mock LLM?                  (IF)    {{ $json.config.USE_MOCK_LLM }} is true
     true  → Mock extraction      (Code)  canned Chat Completions response (free, deterministic)
     false → OpenAI extract claims(HTTP)  POST /v1/chat/completions, strict json_schema
 → Validate claims                (Code)  evidence + figure checks, IDs/permalink attached in code, usage log
 → Build script & gate            (Code)  segments from verified claims only; THROWS on any issue
 → Synthesize audio?              (IF)    {{ $json.tts.enabled }} is true
     true  → ElevenLabs TTS       (HTTP)  MP3 as binary "audio"
 → Package briefing               (Code)  transcript + claim links + MP3 + usage totals
```

The gate is fail-closed: *Build script & gate* throws instead of routing through an IF branch, so a misconfigured condition cannot let unchecked text reach TTS.

### HTTP node settings (already set in the JSON; check them after import)

**OpenAI extract claims**
- Method `POST`, URL `https://api.openai.com/v1/chat/completions`
- Authentication: *Predefined Credential Type* → *OpenAI* → select your OpenAI credential
- Send Body: JSON, *Specify Body: Using JSON*, value `{{ JSON.stringify($json.openai_body) }}`
- Settings: Retry On Fail, 3 tries, 3000 ms wait. Options: Timeout 120000

**ElevenLabs TTS**
- Method `POST`, URL `https://api.elevenlabs.io/v1/text-to-speech/{{ $json.tts.voice_id }}?output_format={{ $json.tts.output_format }}`
- Authentication: *Generic Credential Type* → *Header Auth* → new credential: Name `xi-api-key`, Value = your key
- Header `Accept: audio/mpeg`
- Body JSON `{{ JSON.stringify($json.tts.body) }}`. This is `{ text, model_id }`, and `text` is only the gated script.
- Options → Response → Response Format **File**, Put Output in Field **audio**

The TTS response replaces the item's JSON. *Package briefing* therefore reads the metadata back with `$('Build script & gate').first().json`. If you rename a node, update every `$('…')` reference in the Code nodes.

## CONFIG switches (top of *Prepare article & request*)

| Key | Default | Meaning |
|---|---|---|
| `USE_MOCK_LLM` | `true` | `false` = real OpenAI call |
| `SYNTHESIZE_AUDIO` | `false` | `true` = ElevenLabs after the gate passes |
| `TEST_MODE` | `'none'` | `bad_quote` / `wrong_basis` / `advice_in_script` inject faults |
| `BLOCK_ON_ANY_REJECTED_CLAIM` | `true` | Dev setting: one bad claim stops TTS. Later set `false` to drop bad claims and narrate the rest |
| `OPENAI_MODEL` | `gpt-5-mini` | Add the model's prices to `PRICES.openai` first, otherwise cost is logged as `null` |
| `OPENAI_REASONING_EFFORT` | `'low'` | Only sent for `gpt-5*`/`o*` models. Set `null` for non-reasoning models |
| `ELEVENLABS_VOICE_ID` | placeholder | The gate blocks if audio is on and this is unset |
| `ELEVENLABS_MODEL_ID` | `eleven_flash_v2_5` | 0.5 credit/char. `eleven_multilingual_v2` costs 1 credit/char and sounds better. Pick one for the demo after listening |
| `MAX_TTS_CHARS` | 3000 | Cost guard |
| `PROFILE.duration_seconds` | 180 | Word budget = duration × 2.5 words/s |

## Test procedure (milestone 2 "done" criteria)

| # | Setting | Expected |
|---|---|---|
| 1 | Defaults | Green run. *Package briefing* holds 6 verified claims, 9 transcript segments and `audio.synthesized: false`. Compare with `expected_output_happy_path.json` (IDs/timestamps differ) |
| 2 | `TEST_MODE: 'bad_quote'` | Red at *Build script & gate*: `[claim c1 …] evidence_not_found_in_article`. The quote was paraphrased, so it is no longer an exact span of the article |
| 3 | `TEST_MODE: 'wrong_basis'` | Red: `[claim c3 …] basis_not_supported_by_evidence:month_over_month, basis_conflicts_with_evidence:year_over_year`. **The quote still matches exactly.** This shows that a matching quote does not mean the claim is supported |
| 4 | `TEST_MODE: 'advice_in_script'` | Red: `[segment 2 (claim)] investment_advice_language` |
| 5 | `USE_MOCK_LLM: false` | Real extraction of the fixture. Expect 5–7 verified claims. If claims are rejected, read the `errors` in *Validate claims* before you change any lexicon |
| 6 | + `SYNTHESIZE_AUDIO: true` | MP3 under binary `audio`. **Listen to it**: decimals, "15:00", the name "Norland krone" |
| 7 | Teammate test | Someone who didn't build the workflow hears a number, opens `transcript[i].sources[0].url`, and confirms the value, unit and period |

Every blocked run puts `REPORT {…}` in the error message. It contains the counts, every issue and the usage log, so a blocked run still shows what was spent.

## Extraction prompt and schema

Both live in `01_prepare.js` (`SYSTEM_PROMPT`, `CLAIM_SCHEMA`) and are sent with `response_format: { type: "json_schema", strict: true }`.

- One figure per claim. `evidence_quote` must be an exact contiguous span of the article text, in the original language, and must include the words that set the unit, period and comparison basis.
- What happened, how the market moved, and who says why are kept apart. A cause appears only as `attributed_view`, with `attribution`.
- The model never outputs URLs or IDs. `claim_id`, `story_id`, `source_article_id` and `source_url` are attached in *Validate claims*.
- The system prompt comes first, so OpenAI's automatic prompt caching can apply once the prefix is long enough. `cached_input_tokens` is logged.

## What the checks do (*Validate claims* → `claims[].errors`)

| Check | Rejects when |
|---|---|
| Evidence | The quote is not an exact substring of the article text (case, whitespace, curly quotes and dashes normalized), is shorter than 20 or longer than 600 chars, or contains "…" |
| Numbers | A number or time in the statement is not in the quote, `value_text` is not in the quote, `value` ≠ `value_text`, or the key figure is missing from the statement |
| Period | A month named in the statement is not the month in the quote |
| Unit | %, percentage points or bp is not present in both the quote and the statement (percent ≠ percentage points) |
| Currency | The currency symbol or code is missing from the quote or the statement |
| Basis | m/m, y/y, q/q, YTD, intraday or close is missing from the quote or statement, or the statement uses a conflicting basis |
| Direction | The up/down wording in the statement is missing, contradicts the figure, or is absent from the quote |
| Estimate vs actual | An estimate or forecast is not marked as one, or an actual and an estimate appear in one claim |
| Attribution | A view or estimate has no attribution, or the statement doesn't name who said it |
| Causality | Causal wording ("because", "driven by", "amid" …) appears outside an attributed view |
| Advice | Buy/sell/recommend/price target/Zacks Rank wording |

The gate then re-checks every **spoken segment**. Each number must be in the evidence of the claims that segment cites. Factual segments must carry claim IDs, all of them verified. Template segments may not contain numbers. Spoken normalization ("%" → "percent") may not change any digit. There is also a length cap. This second check is what still protects you once an LLM writes the script (milestone 4).

The lexicons cover EN/DE/NL keywords and decimal commas for `de`/`nl`. They are tuned on one fixture. **Expect false rejections on real Newstex text**, for example a comparison basis that is only implicit ("rose 0.3% in October"). Fix these by loosening a lexicon entry or the prompt, never by turning a check off, and log every change.

## Usage logging

`Package briefing` → `usage.rows[]` has one row per stage: `stage, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, est_cost_usd, cache_key, cache_hit, mocked`. The TTS row has `billable_characters, est_credits`. `usage.totals` adds `elapsed_ms`.

- Prices in `CONFIG.PRICES` are list prices as of Nov 2026 (gpt-5-mini $0.25 / $0.025 cached / $2.00 per 1M tokens). **Check them again before the cost slide.** ElevenLabs USD per credit depends on your plan: fill `usd_per_1k_credits`.
- With reasoning models, reasoning tokens are billed as output and are likely to dominate the cost per article. Compare `reasoning_effort` settings on the same labeled examples.
- The retry count is not visible from the HTTP node (`retries: null`).
- `cache_key = content_hash | prompt_version | model` is ready for an extraction cache in Workflow A. Nothing reads it yet.
- To persist rows: append `usage.rows` to an n8n Data Table (if your instance has them) or download the execution output as JSON.

## Version- and workspace-dependent points

1. **Tested in n8n 2.48.7 (CLI, headless)**:
   - Import works.
   - The default mock run is green.
   - All three TEST_MODEs throw "TTS BLOCKED".
   - A full run against local stand-in endpoints passed through both HTTP nodes. It confirmed the `Authorization: Bearer` header via the OpenAI credential, the `xi-api-key` header, the JSON bodies and the binary MP3 reaching *Package briefing*.
   - **Not tested**: the real OpenAI API accepting the strict schema, and real ElevenLabs audio. Those are tests 5 and 6.
   - Node versions are Code v2, IF v2 and HTTP Request v4.2. Older 1.x instances should import the workflow, but this is unverified.
2. **OpenAI as a predefined credential in the HTTP node** works on current n8n (tested). If the BuilderBase key comes with its own base URL or proxy, change the URL and use *Header Auth* with `Authorization: Bearer <key>`.
3. **Which models the BuilderBase key can use** is unknown. If `gpt-5-mini` returns 404 or 403, pick another model, add its prices, and set `OPENAI_REASONING_EFFORT: null` if it is not a reasoning model.
4. **`require('crypto')` in the Code node** was blocked in the n8n 2.48 test run, which used the task runner. It is allowed only with `NODE_FUNCTION_ALLOW_BUILTIN=crypto`. Otherwise the code falls back to a non-cryptographic hash (`cyrb53:` prefix), which is enough for exact-copy dedup.
5. **Execution history** stores the full article text and the prompts. On hosted n8n, check retention before you process real data, or turn off saving successful executions for this workflow.
6. **Do not paste API keys into Code nodes or the exported JSON.** The export contains no credentials. Each teammate selects theirs after import.

## Next step (after test 7 is green)

Replace `RAW_ROW` with a real Invezz/ActionForex October PPI row once data processing is cleared, after checking the real field paths. Then run test 5 on both articles and diff their claims by `figure` (value, basis, period, measure). That diff is the material-disagreement check for milestone 3.
