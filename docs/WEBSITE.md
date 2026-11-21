# Liquid Briefing – Website v1.4.0 (Deweys Crew, EN/DE/NL)

v1.0.0: five host characters (Pip, Tide, Flo, Brook, Rain) from the Character PDF and Voice Guide. The chosen host decides story choice (covers/skips, strict), order, sentence pattern, word lists, number style, uncertainty line, opener/sign-off and voice. The profile adds name, topics/companies (weighting inside the host's areas) and length; the knowledge level only refines how much gets explained. The waiting screen and the player show the host from `liquid-crew.js`, filling with real pipeline progress and draining with the time left.

## Supabase
- Project `vceblqjzqcfkqzzvehps` (eu-west-1). Table `public.profiles` (one row per auth user, RLS: users read/write only their own row). Schema: `supabase/schema.sql`. v1.0 adds `character` (pip/tide/flo/brook/rain); v1.3 adds `language`, `country`, `quiz`.
- **Authentication → Sign In / Providers → Email → "Confirm email" OFF** (otherwise signup sends a mail and gives no session).
- The page uses the publishable key (public by design). n8n never talks to Supabase: the page sends the profile with the job.

## Architecture

```
Browser ── Supabase Auth + profiles (direct, with the user's token)
        ── GET /webhook/lb-app ─────────► Workflow C  "Website"      → the page (HTML)
        ── GET /webhook/lb-start?…&profile=… ► Workflow B  "Website start" → {job_id} at once, pipeline runs in the background
        ── GET /webhook/lb-status?job=… (every 3 s) ► Workflow C  reads lb_jobs → status + stage + progress
        ── GET /webhook/lb-audio?job=… ─────────► Workflow C  reads lb_audio → audio/mpeg
```

## Hosts (Workflow B, node "Finalize profile" → `CHARACTERS`)
| Host | Covers | Voice (ElevenLabs premade) | Speed | Pause |
|---|---|---|---|---|
| Pip · Before Class | commuting, cost of living, jobs, everyday tech | Will (young, laid-back) | 1.05 | 0.25 s |
| Tide · Before Markets | central banks, macro data, market reaction, calendar | Daniel | 1.1 | 0.2 s |
| Flo · Before the Shift | ports, shipping, strikes, commodities, tariffs | River | 1.0 | 0.6 s |
| Brook · Before Opening | borrowing, energy/input prices, regulation, spending | George | 0.98 | 0.35 s |
| Rain · Before the School Run | rent/mortgages, groceries/energy bills, school, transport | Matilda | 0.95 | 0.45 s |

- Planner: host filters, profile weights. Today's free text wins over the host's covers; if another host fits the question better, the page shows a tip ("Ask Tide the same question").
- Strict topics win over length: with little fitting news the planner plans shorter and gives `short_reason`, shown on the page. No padding.
- Writer: system prompt is the host (rules, pattern, numbers, uses/never words, uncertainty line, allowed segment kinds). Never-words are checked by code and repaired by the verifier.
- Opener and sign-off are written by code per host + name, no facts. ElevenLabs has no pitch setting: pitch comes from the voice choice; longer pauses = sentence breaks in the TTS text.

## Languages (v1.3: English, German, Dutch)
- Profile stores `language` (en/de/nl) and `country` (ISO code; weights regional news via `region`). The start page has a "Language today" switch.
- The whole website is translated (`web/parts/i18n.js`, `STR.en/de/nl`); country names come from the browser (`Intl.DisplayNames`).
- Workflow B: the planner writes `interpretation`/`short_reason` in the language, the writer writes every segment in it (decimal comma, local scale words), number checks parse German/Dutch numbers, openers/sign-offs and short notes are translated, each host keeps its ElevenLabs voice. Words per second: en 2.5, de 2.2, nl 2.4.

## Onboarding: find your host (designed in the canvas "Liquid Briefing – Design System v1", row "Onboarding — find your host")
Name → country & language → 6 quiz questions (morning, headline, what the news should answer, numbers, knowledge level, topics; the matching hosts rise live) → follow & usual length → reveal animation (host drops into the water, splash, says hello by name; "Meet the other hosts" opens the carousel). Answers and scores are saved in `profiles.quiz`. The profile page (round button top right) changes language, country, name, length, following and host, or retakes the quiz.

## Library (v1.4)
Round button top right → Profile | Library. After every new briefing the page saves a compact copy (transcript, host, language, question, summary) to `public.briefings` and the MP3 to the private storage bucket `briefings/<user_id>/<job_id>.mp3` (RLS: each user sees only their own). The library lists them newest first; tapping one opens the player with the stored audio. Briefings made before v1.4 are not in the library.

## Real progress
B writes a `running` row per stage into `lb_jobs` (`result_json = {stage, progress, label}`): start 0.04 → planning 0.12 → reading 0.3 → writing 0.5 → checking 0.72 → recording 0.84 → done 1. The side branches sit above the main line so they run first (execution order v1). The page jumps the water at each real stage and creeps only up to just below the next stage in between.

## Setup / update
1. Workflow B (now `KWKZQDRLx5OPo8FY`): open it → select all → delete → ⋯ → *Import from file* → `liquid-briefing-B-personal-briefing.TEAM-INSTANCE.workflow.json` → Save → Publish. Same workflow id, same webhook paths.
2. Workflow C (now `JAsPNqfFQRKCdjq1`): same with `liquid-briefing-C-website.TEAM-INSTANCE.workflow.json`.
3. GitHub Pages: replace `index.html` with `out/index.html`.

## Data Tables
- `lb_jobs`: job_id, status (running/done/error), created_at, input_json, result_json, error. Append-only; stage rows are `running`. The newest ~400 rows are kept.
- `lb_audio`: job_id, audio_b64. Only the newest 6 are kept.

## Known limits
- Transcript sync uses exact segment start times from ElevenLabs `/with-timestamps` (field `t` per transcript item); briefings made before that fall back to proportional timing.
- Archived briefings made before the library existed are not listed.
- Anyone with the URL can start briefings and spend credits. Unpublish B after the demo.
- Change the page: edit `web/parts/*` → `node build_workflow_c.js` → re-import C. The page must not contain `{{`.

## v1.4 (21 Nov 2026)
- Glossy crew: all characters (`web/parts/liquid-crew.js`, inline Dewey in `web/parts/dewey.js`) have a soft-vinyl finish: shaded white body with specular highlight and rim light, candy-blue water/pads/cheeks, lacquered black parts. Gradients live inside each component (shadow DOM) or use per-instance ids (inline Dewey).
- Library: Profile | Library tabs; briefings are saved to Supabase (`briefings` table, private storage bucket `briefings/<user_id>/<job_id>.mp3`), newest first, replay with audio.
- Player: transcript follows the speech via ElevenLabs timestamps; timeline fill is clipped cleanly (no left-edge flicker).
- Pip's voice: ElevenLabs premade "Will" (young, laid-back).
