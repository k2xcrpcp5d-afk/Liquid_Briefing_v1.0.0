# Workflow B – one personal briefing per listener

File: `liquid-briefing-B-personal-briefing.workflow.json`, 21 nodes plus a sticky note. Workflow A must have run first: B reads `lb_stories` and `lb_articles`.

**Input:** a form. You enter a free-text "About you" and/or pick a demo preset, plus a length.
**Output:** a downloadable HTML page with:
- the audio player;
- the transcript, with a source link for every fact;
- "Why you got this briefing": the profile and the reason behind each setting, the stories chosen with their score breakdown, the stories that were close but not chosen, what was filtered out, and the fact checks per story;
- the cost of this briefing.

## Flow

```
Listener onboarding (form)
 → Build profile          free text → fixed profile + WHY each field was set (keyword rules)
 → [Parse with LLM?]      optional: a small model parses the text (USE_LLM_PROFILE_PARSER)
 → Finalize profile       validate fields, apply Length, tone → voice preset
 → Create lb_claims · Get stories · Get articles · Get claim cache   (Data Tables)
 → Select stories         rank stories for THIS profile, explain every decision (no LLM)
 → Build extraction requests   only for chosen stories not yet in the claim cache
 → [All claims cached?] → OpenAI extract claims (batched)
 → Validate claims (batch)    same checks as M2
 → [New claims?] → Insert lb_claims   (cache: the next listener pays 0 for these)
 → Build script & gate    script from VERIFIED claims only; blocks on any unsupported number or advice
 → [Synthesize audio?] → ElevenLabs TTS (voice and speed from the profile)
 → Package briefing page  JSON + HTML page (MP3 embedded)
 → Show briefing          the form returns the page
```

## What the profile changes

| Profile field | Selection | Script | Audio |
|---|---|---|---|
| topics, entities | Only stories whose **representative article** matches a topic, or that name a company the listener follows | – | – |
| region | +0.5 score for stories in that region's sections | – | – |
| expertise | Beginner: max 3 stories. Intermediate: 5. Expert: 7. Always limited by the time budget | Beginner: 2 claims and at most 1 number per story, plus explainers for terms such as producer prices, IPO or shareholder lawsuit. Expert: up to 4 claims | – |
| duration_seconds | Time budget (2.5 words per second) | Trailing claims are cut if the script is too long | – |
| tone | – | Intro and outro wording (calm / neutral / energetic) | Voice preset: `calm_warm` = River, `neutral_news` = Bella, `energetic` = Matilda |
| pace | – | – | `voice_settings.speed` |

Facts and checks are the same for everyone. A request such as "tell me what to buy" is recorded in the profile trace and ignored.

Demo profiles: `A_general_eu_90s`, `B_fx_markets_3min`, `W1_crypto_ai`, `W3_nvidia_holder`. To give A and B the same voice, set `FORCE_VOICE_PRESET = 'neutral_news'` in *Finalize profile*.

## First test

1. Run Workflow A once, so that the Data Tables exist.
2. Import B into a **new, empty** workflow (*Create Workflow* → ⋯ → *Import from File*).
3. Create an OpenAI credential (BuilderBase key) and select it in **OpenAI extract claims**. Select it in *OpenAI profile parser* too, if you turn the parser on.
4. Click *Execute workflow*. A form opens. Pick `A_general_eu_90s` and submit.
5. Open the result. Either the form offers it as a download (node *Show briefing*), or open *Package briefing page* → *Binary* → `briefing_page` → Download, then open the file in a browser.
6. Run `B_fx_markets_3min`, then free text. Compare the "Why" sections.
7. Audio: in *Build script & gate* set `SYNTHESIZE_AUDIO: true`, then select a Header Auth credential (name `xi-api-key`, value = ElevenLabs key) in *ElevenLabs TTS*.

## Where you put your own editorial values

| You want to change … | Node → setting |
|---|---|
| What counts as relevant for a topic | *Select stories* → `TOPIC_MAP` |
| What is never narrated, or gets down-ranked | *Select stories* → `ADVICE_SECTIONS`, `SOFT_NEWS`, `ADVICE_HEADLINE` |
| How much recency, multiple outlets, region and topic weigh | *Select stories* → the `score =` line |
| How far back "today's news" reaches; stories per expertise level | *Select stories* → `WINDOW_HOURS`, `MAX_STORIES`, `WORDS_PER_STORY` |
| How the briefing sounds: intro, outro, transitions, explainers | *Build script & gate* → `INTRO`, `OUTRO`, `ORD`, `GLOSSARY` |
| Voices and their settings | *Build script & gate* → `VOICE_PRESETS` |
| How free text is understood | *Build profile* → keyword lists, or `USE_LLM_PROFILE_PARSER: true` |

After every change, run the same 3 profiles again and compare the "Why" sections. That is your evaluation loop.

## Test status

**Tested in a local n8n 2.48.7**, using real Data Tables built from the real snapshot. OpenAI and ElevenLabs were replaced by local stand-ins.
- Every branch ran: LLM profile parse, claim extraction, cache insert, TTS and HTML page, in 2.3 seconds.
- A second identical request made **0 extraction calls** (cache hit) and took 0.6 seconds.
- The keyword parser was checked on several texts. "relaxed voice" → calm, River voice, speed 0.88. "not very experienced" → beginner. "90 seconds" / "3 minutes" → duration. "I trade FX" → expert. "Tell me what to buy" → recorded in the trace and ignored.
- Leads differ between profiles. A (general, Europe, beginner) leads with world news. B (FX, 3 minutes) leads with the dollar and central banks.

**Not tested yet:**
- the **real** OpenAI claim extraction on these articles (quality and rejection rate);
- real ElevenLabs audio;
- the form itself and the *Show briefing* download step. The local test used a webhook instead of the form.

**Known weakness:** the false merges from Workflow A, for example the dollar story that also contains the Trump–Xi summit preview, land in the briefing as one story. Turning on the cluster check in A should split them; that model check is untested so far.
