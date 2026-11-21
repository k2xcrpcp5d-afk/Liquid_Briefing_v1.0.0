# Liquid Briefing v1.0.0

A personal audio news briefing you can check. Built for the Sourcera track "The Liquid Briefing" at the MAIN Summit Hackathon, Maastricht (20–21 Nov 2026).

Dewey and his crew (Pip, Tide, Flo, Brook, Rain) pick the day's stories for one listener, write a short spoken briefing in the voice of the host the listener chose, check every sentence against the source article, and read it out with ElevenLabs. **Every factual sentence links to the article it came from.** No investment advice.

- **Languages:** English, German, Dutch (briefing and website)
- **Stack:** n8n (Code + HTTP nodes, Data Tables), OpenAI, ElevenLabs, Supabase (auth, profiles, library), static page on GitHub Pages
- **Live page:** `index.html` in this repo (GitHub Pages); it talks to our n8n webhooks and Supabase

## How it works

```
Newstex feed (JSONL)
 → A  ingest & group          translations merged, exact copies dropped, articles grouped into stories (rules, no LLM)
 → E  add archive             older Zacks articles (28 Jul – 11 Nov) stored as one-article stories, findable by search
 → D  pre-extract             every article once: claims with an exact evidence quote, checked by code, cached in lb_claims
 → B  personal briefing       per listener: profile → search over ALL articles → planner → writer → fact check → gate → TTS
 → C  website + API           serves the page, job status (with real progress) and the audio
```

**Trust, in order**
1. Claims are extracted with an exact quote from the article (`gpt-5-mini`, strict JSON schema).
2. Code checks each claim: the quote, numbers, unit, period, comparison basis, direction, estimate vs actual, attribution, causality and advice. About 40 % of proposed claims are rejected here.
3. The writer (`gpt-6.1-terra`) may only use verified claims. Hosts change tone and order, never facts.
4. An LLM fact checker (`gpt-5-mini`) can only remove or repair sentences. A repaired sentence must pass the number checks again, and it must not change a figure's comparison basis, direction or estimate status.
5. The gate is fail-closed: unchecked text never reaches the audio.
6. IDs and source URLs are attached in code, never by a model.

**Fit to the listener**
- Onboarding quiz → one of five hosts. Each host has its own topics, sentence pattern, number style, words it uses and never uses, and voice.
- Profile: name, country (weights regional news), language, companies and topics to follow, usual length.
- "Today" box: a free-text question. It is searched against the headline, summary and full text of every article, including the archive, and the hits always reach the planner (`gpt-6.2-sol`).

**Listening**
- ElevenLabs `eleven_v4_turbo`, one premade voice per host (Pip: Will, Tide: Daniel, Flo: River, Brook: George, Rain: Matilda).
- Transcript follows the speech using ElevenLabs timestamps. Tap a line to jump; every fact has its source link.
- Library: every briefing is saved to the listener's account (Supabase), newest first, with audio.

## Repository

| Path | What |
|---|---|
| `index.html` | The built website (GitHub Pages). Same as `web/site/index.html` |
| `web/parts/` | Website source: `body.html`, `app.js`, `i18n.js` (EN/DE/NL), `liquid-crew.js` (animated glossy crew), `dewey.js`, CSS |
| `web/build_page.js` | Builds the page from `web/parts/*` + a config (`web/config.json` / `web/config.site.json`) |
| `code/` | Every n8n Code node, one file each. `*.tmpl.js` get shared helper regions inserted at build time; never edit `*.built.js` |
| `build_workflow_*.js` | Generate the importable n8n workflows into `out/` (`a`, `b`, `c`, `d`, `e`; `build_workflow.js` = the M2 test bench) |
| `out/*.workflow.json` | Ready-to-import workflows. `TEAM-INSTANCE` = credentials pre-linked for our n8n |
| `out/answer_key.json`, `topic_map.json`, `dataset_profile.json` | Grouping answer key (IDs only), topic → section map, dataset statistics (counts only) |
| `out/expected_*.json` | Expected outputs of the M2 test bench (fictional fixture) |
| `supabase/schema.sql` | Tables `profiles`, `briefings` and storage policies (RLS: users see only their own rows) |
| `docs/WEBSITE.md` | Website, hosts, languages, onboarding, library, setup |
| `docs/history/` | Earlier handoff docs (M2, workflows A/B) |
| `*.js` in the root (`harness*.js`, `grouptest.js`, `adversarial.js`, `realtest.js`) | Local tests without n8n |

## Setup

1. **n8n credentials:** "OpenAI account" (OpenAI API) and "Header Auth account" (Header Auth, name `xi-api-key`, value = ElevenLabs key). Keys live only in n8n credentials, never in code or exports.
2. **Supabase:** run `supabase/schema.sql`. Authentication → Email → "Confirm email" off. Put the project URL and publishable key into `web/config.json`.
3. **Build:** `node build_workflow_a.js`, `node build_workflow_b.js instance`, `node build_workflow_c.js`, `node build_workflow_d.js instance`, `node build_workflow_e.js`.
4. **Import** each `out/*.workflow.json` into n8n (into an empty workflow), save and publish.
5. **Data:** run A with the dataset files, then E (upload `zacks.jsonl`), then D (`GET /webhook/lb-preextract?limit=300&from=2026-07-01`, repeat until nothing is left).
6. **Website:** `node web/build_page.js web/config.site.json web/site/index.html` and publish `index.html`.

## Tests

```bash
node grouptest.js            # grouping against the answer key (needs the dataset in ./data)
node harness.js none         # M2 claim checks on the fictional fixture
node adversarial.js          # attacks on the claim checks (wrong basis, paraphrased quote, advice, …)
node harnessB.js "<about me>" "custom (use my text)" 90   # Workflow B with fake models
```

## Data and licence

- The Newstex dataset is provided for the hackathon only. **It is not in this repository** and must be deleted after the event (`data/` and `*.jsonl` are git-ignored).
- No article text, excerpts or evidence quotes are committed. The page shows only our own sentences, publisher names, headlines and links.
- The Supabase key in `web/config*.json` and `index.html` is the publishable (public) key; access is protected by row-level security.
- Before or right after the demo: unpublish workflow B (anyone with the URL can start briefings) and delete the Data Tables with article text.
