# Workflow A – load and group the Newstex snapshot

File: `liquid-briefing-A-ingest-group.workflow.json`, 16 nodes plus a sticky note.

Workflow A reads all six JSONL files once and turns them into **stories**. A story is one news event, with its articles, translations and outlets. The workflow then writes everything to two n8n Data Tables. By default it uses **no LLM**. A small model can optionally check the clusters that matter, and it is only allowed to *split* them.

Workflow B (per listener) later reads only these tables. A wildcard profile therefore never re-runs ingestion or grouping.

## Run it

1. **Import** the JSON. In the workflow settings, *Binary mode* must be **separate** (it is preset in the JSON).
2. **Open the form.** Click *Upload JSONL files* → *Test URL* (or publish the workflow and use the Production URL), then upload all six files at once.
   - The original files total 28 MB, with Zacks alone at 19 MB. If the upload is rejected for size, use the **slim files** (`newstex_slim_DO_NOT_COMMIT.zip`, 11 MB). They contain only the fields the workflow uses. The grouping result is identical; this was tested.
3. **Check the result in *Run report*:** counts, LLM calls and cost, and rows inserted.
4. **Check the tables.** *Overview → Data tables* shows `lb_stories` and `lb_articles`. They are created automatically, and every run replaces their rows.

## Node by node

| Node | What it does | LLM? |
|---|---|---|
| Upload JSONL files | Form with a multi-file upload | – |
| Parse JSONL | Reads every uploaded file and outputs one item per article row. Reports rows and parse errors per file | – |
| **Normalize, link & group** | The core, explained below | – |
| Prepare cluster checks | Picks clusters where a wrong merge would matter (≥ 2 outlets or ≥ 3 articles) and builds one small request per cluster. `USE_LLM_CLUSTER_CHECK` switches it on | – |
| LLM check skipped? | Skips the HTTP node when the check is off | – |
| OpenAI cluster check | Sends the requests in batches of 5 per second, with up to 3 tries | small model |
| Apply checks & build rows | Splits clusters the model separated, re-attaches translations, and builds flat table rows (arrays stored as JSON strings) | – |
| Create / Clear lb_stories, lb_articles | Create the tables if they are missing, then empty them. Each runs only once (*Execute Once*) | – |
| Story rows → Insert lb_stories, Article rows → Insert lb_articles | Bulk insert | – |
| Run report | Counts, cluster-check cost, inserted rows | – |

### Inside *Normalize, link & group*

All settings are in `CFG` at the top of the node.

1. **Normalize.** Takes fields from `$id`, `publication.name`, `source` (the author) and `provider_categories`. Articles before `GROUP_FROM` (12 Nov) are kept as `archive`. They are indexed but never grouped; this is mostly old Zacks articles.
2. **Exact copies.** Articles with an identical cleaned body become `exact_copy`.
3. **Translations.** A DE or NL article is linked to the nearest English Invezz article by the same author within 15 minutes. An NL article whose English original is missing is linked to its DE twin. Translations inherit the story and are **not counted as extra outlets**.
4. **Roundups.** Headlines such as "Evening digest" or "5 things to know" are never used as a cluster anchor.
5. **Features.** Each article gets:
   - TF-IDF over the headline (counted twice), the excerpt and the first 600 characters of text;
   - named entities. Names are taken from the excerpt and lead when the headline is in Title Case, because a Title Case headline makes every word look like a name;
   - a coarse event type from the headline, or else the excerpt: legal, leadership, macro_data, central_bank, earnings, deal, or market_move (headline only);
   - a preview flag ("ahead of", "what to expect").
6. **Pair score.** Only articles at most 30 hours apart that share at least one named entity are compared. The score is the cosine similarity, plus a bonus for each additional shared name, plus a bonus for the same event type. A different event type multiplies the score by 0.6, and a preview paired with a result by 0.5.
7. **Clustering.** Clusters are merged by *average* similarity, so a single bridge article cannot chain unrelated stories together.
   - Pass 1 merges at 0.30.
   - Pass 2 merges two clusters that already have at least 2 articles each, at 0.20, but only if they share a core name. A core name is one that at least half the articles in each cluster mention.
   - No cluster may span more than 36 hours. Multi-day sagas are therefore split into separate events.
8. **Story record.**
   - The representative article comes from the outlet with the highest weight and has the longest text.
   - `editorial_score` = independent outlets + log of the article count + outlet weight − age penalty.
   - Stories on different days that share their top name get a `storyline_id`, for example `line_jensen`.
9. **Ambiguous pairs.** Pairs from different outlets with a score from 0.20 up to the 0.30 threshold are counted in the report. They are not used yet: a later LLM step could merge them, but at the moment the model may only split.

## Results on the real snapshot (local n8n 2.48.7, 7 seconds per run)

- 1,740 articles: 919 archive, 239 translations, 8 roundups, 574 grouped.
- **413 event stories**: 83 with more than one article, 14 with more than one outlet.
- **Answer key: 21 out of 21 checks pass.**
  - PPI (ActionForex and Invezz) is one story.
  - The Intel lawsuit (Invezz and IBTimes) is one story.
  - The Huang exit is one story across Invezz, IBTimes and Zacks.
  - Huang keeping the door open on 17 November (Invezz and IBTimes) is a separate story.
  - All translations are linked.
  - The five decoy articles stay separate: the preview, the USD/JPY reaction, the chip selloff, Intel on Tuesday and the digest.
- **Known false merges with rules only** (found by reading the 14 multi-outlet stories):
  - Trump "AI national champions" ended up in the Huang story of 16 November.
  - Dollar after the US retail sales data was merged with the Trump–Xi summit preview.
  - A US-dollar ETF article was merged with SCHD dividend yields.
  - The Trump Supreme Court filing was merged with the CFTC lawsuit against Louisiana.

  The cluster check (41 calls) is the step designed to split these.
- **Cluster check:** the full branch ran in local n8n against a stand-in for OpenAI: 41 calls, 6 splits, about $0.03 at list price (an estimate). **It has not yet run against the real OpenAI API**, so the quality of its split decisions is unmeasured.

## Tables

`lb_stories`: `story_id, kind (event|roundup), title, first_seen, last_seen, outlets*, independent_outlet_count, article_count, article_ids*, translation_ids*, representative_article_id, entities*, provider_categories*, phase, editorial_score, storyline_id, check_status (rules_only|llm_confirmed|llm_split|llm_invalid_kept|roundup), check_label, split_from`

`lb_articles`: `article_id, story_id, role (anchor|member|translation|exact_copy|roundup), feed, publication, permalink, language, published_at, headline, excerpt, author, provider_categories*, content_hash, translation_of, copy_of, text_len, text_content`

\* stored as JSON strings (Data Tables accept no arrays).

`text_content` is internal. It is used for claim extraction and must never be shown in the player. `lb_articles` holds about 3.3 M characters. The Data Table size limit of your n8n plan is not confirmed.

## Test locally without n8n

```
node grouptest.js        # grouping vs answer_key.json (expects the JSONL files in ./data)
node harnessA.js         # full Code-node chain, rules only
node harnessA.js llm     # with a fake model that exercises the split path
```
