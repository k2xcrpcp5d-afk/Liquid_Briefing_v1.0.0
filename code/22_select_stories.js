// ============================================================================
// WORKFLOW B — NODE: "Build planner request"   (Code node, Run Once for All Items)
// 1) Filters today's stories to what is always valid (news window, article text, no advice/rating
//    sections, no roundups) -> the CATALOG the planner sees (one compact line per story).
// 2) Asks a strong reasoning model (the PLANNER) to interpret the listener and plan the briefing.
// 3) Keeps the old rules-based ranking as FALLBACK in case the planner fails.
// Output: one item { ...profile, catalog, fallback, use_planner, openai_body }.
// ============================================================================
const CFG = {
  USE_PLANNER: true,
  PLANNER_MODEL: 'gpt-6.2-sol',      // strong reasoning model: interprets the listener and plans the briefing
  PLANNER_REASONING: 'medium',
  MAX_CATALOG: 260,                 // stories shown to the planner (most important first)
  BACKGROUND_DAYS: 7,               // older stories of the week are shown as possible background ('how we got here')
  MAX_ARTICLES_LISTED: 8,           // per story, in the planner's inventory
  MAX_READ: [[180, 14], [300, 22], [9999, 36]], // cost cap: articles read in full per briefing, by length
  BRIEFING_DATE: '2026-11-19',
  NOW: '2026-11-19T09:00:00Z',      // "now" = just after the last article in the feed (19 Nov 08:46 UTC)
  SEARCH_HITS: 24,                  // stories found by searching ALL article text for the listener's own words (always shown to the planner)
  WINDOW_HOURS: 48,                 // stories whose latest article is older are not "today's news"
  WORDS_PER_SECOND: 2.5,
  FIXED_WORDS: 35,                  // intro + outro
  // stories per briefing by length; the script writer compresses each story to what matters
  STORIES_BY_LENGTH: [[60, 3], [90, 4], [120, 5], [180, 6], [300, 8], [9999, 11]],
  PINNED_BONUS: 50,                 // stories the listener picked for today always make the candidate list
  BEGINNER_FEWER: 1,               // beginners: one story less, more explanation
  EXTRA_CANDIDATES: 2,             // extra stories the editor may choose from
  SECOND_SOURCE_FOR_TOP: 2,        // top N stories also get a second outlet's article extracted (more context)
  PROMPT_VERSION: 'extract-v4',     // must match the extraction prompt; change it to invalidate the cache
};
const TOPIC_MAP = {
  fx_central_banks: { feeds: ['actionforex'], cats: ['Fed', 'ECB', 'BoJ', 'BoC', 'RBA', 'RBNZ', 'JPY', 'USD', 'Forex', 'Yields'] },
  macro: { feeds: ['actionforex'], cats: ['Market Overview', 'Inflation', 'Economic Highlights', 'Economy'] },
  stocks: { feeds: ['invezz_en', 'zacks'], cats: ['Stock market', 'Indices', 'IPO', 'Mergers & Acquisitions', 'Business', 'Markets', 'Stocks', 'Market News', 'Stocks in the News'] },
  crypto: { feeds: [], cats: ['Crypto', 'Bitcoin', 'XRP', 'Solana', 'Altcoins', 'DeFi', 'Ethereum', 'Cryptocurrency'] },
  ai_tech: { feeds: [], cats: ['Tech', 'Artificial intelligence', 'Artificial Intelligence', 'Technology', 'CyberSecurity', 'Social Media'] },
  commodities: { feeds: [], cats: ['Commodities', 'Precious metals', 'Energy', 'Gold', 'Oil'] },
  world_politics: { feeds: [], cats: ['World', 'Politics', 'National', 'Political'] },
  personal_finance: { feeds: [], cats: ['Personal Finance', 'Finance & Banking'] },
  lifestyle: { feeds: [], cats: ['Entertainment', 'Royals', 'Sports', 'Games', 'Crime', 'Trending'] },
};
const ADVICE_SECTIONS = ['Trading Ideas', 'Trading-ideen', 'Tradingideeën', 'Zacks 1 Rank Additions', 'Bull of the Day', 'Bear of the Day', 'Investment Ideas', 'Analyst Blog Plus'];
const REGION_CATS = { europe: ['Eurozone', 'European Union', 'Germany', 'United Kingdom', 'ECB'], us: ['United States', 'Fed'], asia: ['Japan', 'China', 'BoJ', 'Australia', 'New Zealand', 'RBA', 'RBNZ'] };
const SOFT_NEWS = ['Trending', 'Entertainment', 'Royals', 'Crime', 'Games', 'Sports']; // gossip-style sections: down-ranked unless the listener asked for lifestyle
const ADVICE_HEADLINE = /\b(stocks? to buy|good stock to buy|buy now|should you buy|is it time to buy|strong buy|top picks?)\b/i;

const F = $('Finalize profile').first().json;
const P = F.profile;
const J = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch (e) { return []; } };
const stories = $('Get stories').all().map(i => i.json).filter(s => s.story_id).map(s => ({ ...s, outlets: J(s.outlets), article_ids: J(s.article_ids), entities: J(s.entities), provider_categories: J(s.provider_categories) }));
const arts = Object.fromEntries($('Get articles').all().map(i => i.json).filter(a => a.article_id).map(a => [a.article_id, a]));
const cache = $('Get claim cache').all().map(i => i.json).filter(r => r.article_id && r.prompt_version === CFG.PROMPT_VERSION);
if (!stories.length) throw new Error('lb_stories is empty - run Workflow A (upload the JSONL files) first.');

const briefT = Date.parse(CFG.NOW);
const winStart = briefT - CFG.WINDOW_HOURS * 3600000;
const excluded = {};
const ex = (reason) => { excluded[reason] = (excluded[reason] || 0) + 1; };

// ---- SEARCH: every article in the dataset (incl. the July-November archive) is findable by the listener's own words.
// Deterministic keyword search with rarity weighting (no LLM, no cost). Hits are always shown to the planner.
const STOP = new Set(('the and for with what about this that from have has are was were will would could should into over than then them they their there these those your you our out not but how why who when where which while also just like please tell give want know more much many some any does did doing going happening happened latest news today update updates briefing '
  + 'der die das dem den des ein eine einem einen einer und mit für was ist sind wie warum wer wann über heute nachrichten bitte gibt neues neue vom zum zur auf aus bei nach noch auch '
  + 'anything something everything '
  + 'het een van voor met wat hoe waarom wie wanneer over vandaag nieuws graag aan bij uit naar zijn wordt werd heeft nog ook').split(' '));
const norm = x => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const qText = [P.listener_question || '', ...(P.entities || [])].join(' . ');
const toks = norm(qText).split(/[^a-z0-9$%&-]+/).map(w => w.replace(/^[&-]+|[&-]+$/g, ''));
const words = toks.filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
const phrases = []; for (let i = 0; i + 1 < toks.length; i++) if (toks[i].length >= 3 && toks[i + 1].length >= 3 && !STOP.has(toks[i]) && !STOP.has(toks[i + 1])) phrases.push(toks[i] + ' ' + toks[i + 1]);
const terms = [...new Set([...phrases, ...words])].slice(0, 16);
const search = { terms, hits: [] };
const hitOf = {}; // story_id -> { score, matched }
if (terms.length) {
  const allArts = Object.values(arts).filter(a => a.role !== 'translation' && !a.copy_of);
  const summaryOf = {}; for (const r of cache) if (r.summary) summaryOf[r.article_id] = r.summary;
  const docs = allArts.map(a => ({ a, head: norm(a.headline + ' ' + (summaryOf[a.article_id] || '')), body: norm((a.excerpt || '') + ' ' + (a.text_content || '')) }));
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[^a-z0-9]+');
  const re = Object.fromEntries(terms.map(t => [t, new RegExp('(^|[^a-z0-9])' + esc(t) + (t.length >= 6 ? '' : '([^a-z0-9]|$)'))]));
  const df = Object.fromEntries(terms.map(t => [t, docs.filter(d => re[t].test(d.head) || re[t].test(d.body)).length]));
  const usable = terms.filter(t => df[t] > 0 && df[t] <= docs.length * 0.25);
  const idf = t => Math.log((docs.length + 1) / (df[t] + 1)) * (t.includes(' ') ? 2 : 1);
  const per = {}; // term -> [{story, score}]
  for (const d of docs) {
    if (!d.a.story_id) continue;
    let sc = 0; const m = [];
    for (const t of usable) { const inHead = re[t].test(d.head), inBody = !inHead && re[t].test(d.body); if (inHead || inBody) { sc += idf(t) * (inHead ? 3 : 1); m.push(t); } }
    if (!sc) continue;
    const ageD = (briefT - Date.parse(d.a.published_at)) / 86400000;
    sc *= 1 + 0.15 * (m.length - 1); if (ageD <= 7) sc += 2; // several of the listener's words together, and recent news, rank first
    const h = hitOf[d.a.story_id] || (hitOf[d.a.story_id] = { score: 0, matched: new Set() });
    h.score = Math.max(h.score, sc); m.forEach(x => h.matched.add(x));
    for (const t of m) (per[t] = per[t] || []).push(d.a.story_id);
  }
  // every word or phrase of the question gets its own best hits (round robin), so one concept cannot crowd out another
  const order = usable.slice().sort((x, y) => idf(y) - idf(x));
  for (const t of order) per[t] = [...new Set(per[t] || [])].sort((x, y) => hitOf[y].score - hitOf[x].score);
  const picked = [];
  for (let r = 0; picked.length < CFG.SEARCH_HITS && order.some(t => per[t].length > r); r++)
    for (const t of order) { const id = per[t][r]; if (id && !picked.includes(id) && picked.length < CFG.SEARCH_HITS) picked.push(id); }
  for (const k of Object.keys(hitOf)) if (!picked.includes(k)) delete hitOf[k];
  search.hits = picked.map(id => ({ story_id: id, score: Number(hitOf[id].score.toFixed(2)), matched: [...hitOf[id].matched] }));
  search.df = df;
}

const candidates = [];
const eligible = [];
for (const s of stories) {
  if (s.kind !== 'event') { ex('roundup (never a lead source)'); continue; }
  const last = Date.parse(s.last_seen);
  const weekStart = briefT - CFG.BACKGROUND_DAYS * 24 * 3600000;
  if (!(last < briefT && (last >= weekStart || hitOf[s.story_id]))) { ex(`older than ${CFG.BACKGROUND_DAYS} days`); continue; } // older stories only when the listener's words found them
  const fresh = last >= winStart;
  const rep = arts[s.representative_article_id];
  if (!rep || !rep.text_content) { ex('representative article text missing'); continue; }
  const cats = s.provider_categories;
  if (cats.length && cats.every(c => ADVICE_SECTIONS.includes(c))) { ex('advice/rating section (Trading Ideas, Bull of the Day ...)'); continue; }
  if (ADVICE_HEADLINE.test(s.title)) { ex('headline asks a buy/sell question'); continue; }
  eligible.push(s);
  if (!fresh) { ex(`background only (older than ${CFG.WINDOW_HOURS} h)`); continue; } // the rules fallback ranks only today's news
  const feeds = [...new Set(s.article_ids.map(id => arts[id] && arts[id].feed).filter(Boolean))];
  const why = [];
  let topicScore = 0;
  const matched = [];
  // a story is ABOUT its representative article: only that one qualifies it for a topic; other members add a small bonus
  // (protects against a wrongly merged cluster leaking into the wrong listener's briefing)
  const repCats = J(rep.provider_categories);
  for (const t of P.topics) {
    const m = TOPIC_MAP[t]; if (!m) continue;
    const repHit = repCats.find(c => m.cats.includes(c)) || (m.feeds.includes(rep.feed) ? 'outlet ' + rep.feed : null);
    const memberHit = cats.find(c => m.cats.includes(c)) || feeds.find(fd => m.feeds.includes(fd));
    if (repHit) { matched.push(t); topicScore += 2; why.push(`matches your topic "${t}" (${String(repHit).startsWith('outlet') ? repHit : 'section ' + repHit})`); }
    else if (memberHit) { topicScore += 0.5; why.push(`a related article touches "${t}" (${memberHit})`); }
  }
  topicScore = Math.min(P.focus === 'entities' ? 2 : 4, topicScore); // company briefings: being ABOUT the company beats topic fit
  const ents = s.entities.map(e => String(e).toLowerCase());
  const titleL = s.title.toLowerCase();
  // entity relevance: named in the headline (strong) or one of the story's top-2 names (weaker).
  // "Markets await Nvidia" in a dollar story is weaker than "Nvidia beats estimates".
  let entScore = 0; const entHit = [];
  for (const e of P.entities) {
    const inTitle = new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(titleL);
    const inTop = ents.slice(0, 2).includes(e);
    const titleLead = inTitle && titleL.indexOf(e) < 25; // subject of the headline
    if (inTitle || inTop || ents.includes(e)) { entHit.push(e); entScore += (titleLead ? 6 : inTitle ? 2 : 0) + (inTop ? 1 : 0) + (!inTitle && !inTop ? 0.5 : 0); }
  }
  if (entHit.length) why.push(`about ${entHit.join(', ')}, which you asked about` + (entScore >= 6 ? ' (main subject of the headline)' : ' (mentioned, not the main subject)'));
  const pinned = (P.pinned_story_ids || []).includes(s.story_id);
  if (pinned) why.unshift('you picked this topic for today');
  if (!pinned && P.focus === 'entities' && !entHit.length) { ex(`not about ${P.entities.join(', ')}`); continue; }
  if (!pinned && !matched.length && !entHit.length) { ex('not one of your topics'); continue; }
  if (!pinned && matched.length === 1 && matched[0] === 'lifestyle' && !P.topics.includes('lifestyle')) { ex('not one of your topics'); continue; }
  const regionHit = (REGION_CATS[P.region] || []).find(c => cats.includes(c));
  if (regionHit) why.push(`your region (${regionHit})`);
  if (s.independent_outlet_count > 1) why.push(`reported by ${s.independent_outlet_count} outlets (${s.outlets.join(', ')})`);
  const soft = !pinned && !P.topics.includes('lifestyle') && repCats.some(c => SOFT_NEWS.includes(c));
  if (soft) why.push('down-ranked: soft-news section (' + repCats.filter(c => SOFT_NEWS.includes(c)).join(', ') + ')');
  const ageH = (briefT - last) / 3600000;
  why.push(ageH < 24 ? 'from the last 24 hours' : `${Math.round(ageH)} h old`);
  const recency = P.focus === 'entities' ? -ageH / 24 : 0; // "how is X doing right now": newer beats bigger
  const score = Number((s.editorial_score + topicScore + entScore + recency + (regionHit ? 0.5 : 0) - (soft ? 1.5 : 0) + (P.expertise === 'beginner' ? 0.5 * (s.independent_outlet_count - 1) : 0) + (pinned ? CFG.PINNED_BONUS : 0)).toFixed(3));
  candidates.push({ story_id: s.story_id, title: s.title, outlets: s.outlets, storyline_id: s.storyline_id, representative_article_id: s.representative_article_id,
    article_ids: s.article_ids, matched_topics: matched, pinned, score, score_parts: { editorial: s.editorial_score, topics: topicScore, entities: entScore, recency: Number(recency.toFixed(2)), region: regionHit ? 0.5 : 0, soft_news: soft ? -1.5 : 0 }, why });
}
candidates.sort((a, b) => b.score - a.score);

// ---- pick under the time budget, one story per storyline ------------------------------
const baseN = CFG.STORIES_BY_LENGTH.find(([sec]) => P.duration_seconds <= sec)[1];
const slots = Math.max(2, (P.pinned_story_ids || []).length, baseN - (P.expertise === 'beginner' ? CFG.BEGINNER_FEWER : 0) - (P.style && P.style.busy ? 1 : 0));
// the editor agent gets a few more candidates than slots and decides what is worth the airtime
const maxN = slots + CFG.EXTRA_CANDIDATES;
const perLine = P.focus === 'entities' ? 3 : 1; // a company briefing may use several angles of its storyline
const selected = [], runners_up = [];
const lineCount = {};
for (const c of candidates) {
  if (selected.length >= maxN) { if (runners_up.length < 6) runners_up.push({ ...c, why_not: `not among the ${maxN} candidates for ${P.duration_seconds} s (${P.expertise})` }); continue; }
  if (!c.pinned && c.storyline_id && (lineCount[c.storyline_id] || 0) >= perLine) { if (runners_up.length < 6) runners_up.push({ ...c, why_not: `storyline ${c.storyline_id} already covered` }); continue; }
  if (c.storyline_id) lineCount[c.storyline_id] = (lineCount[c.storyline_id] || 0) + 1;
  selected.push({ ...c, rank: selected.length + 1 });
}
const WPS = P.words_per_second || CFG.WORDS_PER_SECOND;
const perStory = Math.round((P.duration_seconds * WPS - CFG.FIXED_WORDS) / Math.max(1, selected.length));

// ---- claim cache: extract only what is missing -----------------------------------------
const to_extract = [], cached = [];
const fam = p => String(p || '').replace(/ - (German|Dutch)$/, '');
const need = (story_id, a) => {
  const hit = cache.find(r => r.article_id === a.article_id && r.content_hash === a.content_hash);
  (hit ? cached : to_extract).push({ story_id, article_id: a.article_id });
};
selected.forEach((s, i) => {
  const rep = arts[s.representative_article_id];
  s.source_article_ids = [rep.article_id];
  need(s.story_id, rep);
  if (i < CFG.SECOND_SOURCE_FOR_TOP) {
    // a second article from ANOTHER outlet adds context and corroboration
    const other = s.article_ids.map(id => arts[id]).filter(a => a && a.text_content && a.role !== 'translation' && fam(a.publication) !== fam(rep.publication))
      .sort((x, y) => y.text_len - x.text_len)[0];
    if (other) { s.source_article_ids.push(other.article_id); need(s.story_id, other); }
  }
});

const fallback = { plan: { briefing_date: CFG.BRIEFING_DATE, window_hours: CFG.WINDOW_HOURS, budget: { duration_seconds: P.duration_seconds, slots, max_stories: maxN, words_per_story: perStory },
  candidates: candidates.length, selected, runners_up, excluded }, to_extract, cached };

// ---- catalog for the planner ---------------------------------------------------------------
const AREA_OF = cats => Object.entries(TOPIC_MAP).filter(([, m]) => cats.some(c => m.cats.includes(c))).map(([t]) => t);
// what is already known about each article (from the fact cache, incl. the pre-extracted week)
const known = {};
for (const r of cache) known[r.article_id] = { facts: Number(r.verified_count || 0), summary: r.summary || null };
const catalogAll = eligible.map(s => {
  const rep = arts[s.representative_article_id] || {};
  const ageH = Math.round((briefT - Date.parse(s.last_seen)) / 3600000);
  const fresh = ageH <= CFG.WINDOW_HOURS;
  const list = s.article_ids.map(id => arts[id]).filter(a => a && a.text_content && a.role !== 'translation' && !a.copy_of)
    .sort((x, y) => (y.article_id === s.representative_article_id) - (x.article_id === s.representative_article_id) || (known[y.article_id] ? known[y.article_id].facts : 0) - (known[x.article_id] ? known[x.article_id].facts : 0) || y.text_len - x.text_len)
    .slice(0, fresh ? CFG.MAX_ARTICLES_LISTED : 3)
    .map(a => ({ id: a.article_id, outlet: String(a.publication || '').replace(/ - (German|Dutch)$/, ''), date: String(a.published_at || '').slice(0, 10), chars: a.text_len,
      facts: known[a.article_id] ? known[a.article_id].facts : null, summary: known[a.article_id] && known[a.article_id].summary ? known[a.article_id].summary.slice(0, 180) : String(a.excerpt || a.headline || '').replace(/\s+/g, ' ').slice(0, 140) }));
  const hit = hitOf[s.story_id];
  return { id: s.story_id, headline: s.title, when: fresh ? 'today' : ageH <= CFG.BACKGROUND_DAYS * 24 ? 'earlier this week' : 'archive ' + String(s.last_seen).slice(0, 10), age_h: ageH,
    ...(hit ? { search_match: [...hit.matched], search_score: Number(hit.score.toFixed(1)) } : {}), areas: AREA_OF([...J(rep.provider_categories), ...s.provider_categories]).slice(0, 3),
    outlets: s.independent_outlet_count, importance: Number(Number(s.editorial_score || 0).toFixed(1)), names: s.entities.slice(0, 4), storyline: s.storyline_id || null, articles: list };
}).sort((a, b) => (a.when === b.when ? 0 : a.when === 'today' ? -1 : 1) || b.importance - a.importance || a.age_h - b.age_h);
// the search hits always reach the planner, the rest is capped by importance
const catalog = [...catalogAll.filter(c => c.search_match).sort((x, y) => y.search_score - x.search_score), ...catalogAll.filter(c => !c.search_match && !/^archive/.test(c.when)).slice(0, CFG.MAX_CATALOG)];
const maxRead = CFG.MAX_READ.find(([sec]) => P.duration_seconds <= sec)[1];

const targetWords = Math.round(P.duration_seconds * WPS);
const LANG_NAME = { en: 'English', de: 'German', nl: 'Dutch' }[P.language] || 'English';
const ST = P.style || {};
const CH = P.character;
const OTHERS = 'pip (students: commuting, cost of living, jobs, everyday tech), tide (markets: central banks, macro data, market reaction), flo (operations: ports, shipping, strikes, tariffs, commodities), brook (small business: borrowing costs, energy and input prices, regulation, consumer spending), rain (household: rent and mortgages, groceries, energy bills, school)';
const SYSTEM = `You are the PLANNER of a personal audio news briefing. You decide what this listener gets today and why. Other agents will extract verified facts from the stories you choose, write the script and fact-check it - you only see headline-level information now.

TODAY'S HOST IS ${CH.name.toUpperCase()} (${CH.show}), a character for ${CH.listener}. The host decides which stories exist for this briefing:
- ${CH.name} COVERS: ${CH.covers.join('; ')}. A story qualifies when its facts plausibly touch one of these for ${CH.name}'s listener (for example an interest-rate decision touches mortgages for a household host and borrowing costs for a business host).
- ${CH.name} SKIPS: ${CH.skips.join('; ')}. Never plan a story that is mainly about these, even to fill time.
- ORDER: ${CH.order}.
- SHAPE: ${CH.shape}.
Two hosts on the same morning should give clearly different briefings: pick the stories ${CH.name} would pick, not the generally biggest news.

Work in this order:
1. INTERPRET the listener: what do they really want from today's briefing? Today's request (free text) has the highest priority and WINS over ${CH.name}'s covers and skips: answer it with the best matching stories, told ${CH.name}'s way. If another host clearly fits today's request better, name it in "better_character" (otherwise "none"): hosts are ${OTHERS}. Without a request: stories they picked for today, then companies they follow, then their profile topics - all only INSIDE ${CH.name}'s covers (the profile weights, the host filters).
2. List their WISHES in priority order (one per distinct interest). For each wish, name the catalog stories that cover it, or say plainly why none does (for example "no Tesla news in the last 48 hours" or "outside what ${CH.name} covers").
3. PLAN the briefing in speaking order (${CH.order}). Allocate time by what the listener wants: if they ask about one company or topic, it may fill most or all of the briefing with several angles. Widening stays INSIDE the subject and inside ${CH.name}'s covers.
   Roles: "main" (the lead, 150-500 words in long briefings), "second" (a full story, 80-250 words), "quick_hit" (one or two sentences, 25-40 words), "background" (an older story from earlier this week that explains how we got here, 60-200 words).
SEARCH: stories with "search_match" contain the listener's own words somewhere in an article (headline, summary or full text), found by searching every article in the feed, including the archive back to July. When the listener asks about something specific, these are where the answer is: check them first, even if the headline looks unrelated. Stories marked "archive YYYY-MM-DD" are older background: use them only to answer the request, and the writer must say when it was reported.
4. DECIDE WHAT TO READ. Each story lists its articles with outlet, date, length, a one-line summary and "facts" = how many verified facts are already extracted (null = not read yet). For every planned story pick "read_article_ids": the articles whose facts the writer should get. Rule of thumb: about 20 spoken words per verified fact, so a 400-word lead needs 20+ facts - often 3-6 articles from different outlets. Quick hits need 1 article. Prefer articles that add something new. At most ${maxRead} articles in total for this length.
   LENGTH: fill the requested length only with stories that fit ${CH.name}. If today's fitting news is thin, use background stories from earlier this week that fit, then plan a SHORTER briefing and say why in "short_reason" (one plain sentence for the listener, e.g. "Only two stories this week touch ports, shipping or tariffs, so Flo keeps it short."). A short briefing is a correct briefing; never pad with off-topic stories. If the plan fills the length, short_reason is "".
   A full story needs a concrete development with several facts, not just an opinion piece. Opinion pieces, analyst price targets and gossip only if the listener asked for them. Never pick a story for an investment-advice angle.
   Today's picks must be in the plan.
5. Pick 3-5 RESERVE stories that fit ${CH.name} (most useful first) that can replace a planned story if its facts turn out thin.

WRITE FOR THE NEXT AGENTS, NOT FOR YOURSELF:
- "interpretation" is shown to the listener on the result page: one or two plain sentences saying what they get today and why (e.g. "Ole asked about Nvidia; Pip tells it from the everyday side: jobs and the AI tools you use."). No working notes, no instructions about checking sources.
- "angle" is the thread of a story in one sentence, as ${CH.name} would tell it (sentence pattern: ${CH.pattern}). Never instructions like "verify", "distinguish", "do not treat as".
- "why_for_listener" says in one short sentence why this story is in THIS briefing.
- "listener_hooks": 1-3 short phrases about what this listener cares about (e.g. "has a variable mortgage", "follows Nvidia").
- "background_needed": general, timeless concepts the listener needs explained to follow the briefing - only if they are a beginner or asked for it; otherwise empty.

LANGUAGE: the briefing is spoken in ${LANG_NAME}. Write "interpretation" and "short_reason" in ${LANG_NAME} (the listener reads them); everything else in English. The catalog is mostly English and that is fine: the writer translates.

Length: about ${targetWords} spoken words in total (${WPS} words per second) if there is enough fitting news. The target_words of all planned stories should add up to about ${targetWords - 30}, or less with a short_reason.`;

const user = JSON.stringify({
  host: CH.name, language: LANG_NAME, listener: { first_name: P.listener_name || null, expertise: P.expertise, region: P.region, country: P.country || null, profile_topics: P.topics, follows_companies: P.entities },
  today: { request: P.listener_question || null, picked_story_ids: P.pinned_story_ids || [], length_minutes: Math.round(P.duration_seconds / 60), },
  catalog_note: 'All stories of the week that passed basic filters. when = today (last 48 h) or earlier this week (background). areas = publisher sections; names = most mentioned names; importance = rough newsroom importance; articles = what you can read (facts = verified facts already extracted, null = not read yet).',
  max_articles_to_read: maxRead,
  catalog,
}, null, 0);
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['interpretation', 'better_character', 'short_reason', 'listener_hooks', 'background_needed', 'wishes', 'plan', 'reserves'],
  properties: {
    interpretation: { type: 'string' },
    better_character: { type: 'string', enum: ['none', 'pip', 'tide', 'flo', 'brook', 'rain'] },
    short_reason: { type: 'string' },
    listener_hooks: { type: 'array', items: { type: 'string' } },
    background_needed: { type: 'array', items: { type: 'string' } },
    wishes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['wish', 'source', 'covered_by', 'note'],
      properties: { wish: { type: 'string' }, source: { type: 'string', enum: ['today_request', 'today_pick', 'followed_company', 'profile_topic', 'inferred'] }, covered_by: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } } } },
    plan: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['story_id', 'role', 'angle', 'why_for_listener', 'target_words', 'read_article_ids'],
      properties: { story_id: { type: 'string' }, role: { type: 'string', enum: ['main', 'second', 'quick_hit', 'background'] }, angle: { type: 'string' }, why_for_listener: { type: 'string' }, target_words: { type: 'integer' }, read_article_ids: { type: 'array', items: { type: 'string' } } } } },
    reserves: { type: 'array', items: { type: 'string' } },
  },
};
const body = {
  model: CFG.PLANNER_MODEL,
  messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
  response_format: { type: 'json_schema', json_schema: { name: 'briefing_plan', strict: true, schema: SCHEMA } },
  max_completion_tokens: 20000,
  reasoning_effort: CFG.PLANNER_REASONING,
};
return [{ json: { ...F, search, max_read: maxRead, briefing_date: CFG.BRIEFING_DATE, window_hours: CFG.WINDOW_HOURS, target_words: targetWords, catalog, excluded, fallback, prompt_version: CFG.PROMPT_VERSION,
  use_planner: CFG.USE_PLANNER && catalog.length > 0, openai_body: body } }];
