// ============================================================================
// NODE: "Normalize, link & group"   (Code node, Run Once for All Items)
// Workflow A, step 1. No LLM. Input: one item per raw Newstex row (from "Parse JSONL").
// Output: one item per STORY (event cluster) with its member articles, plus one
// final item { _report: ... } with counts, ambiguous pairs and settings.
// ============================================================================
const CFG = {
  GROUP_FROM: '2026-11-12T00:00:00Z',  // older articles are indexed as archive, not grouped
  BRIEFING_DATE: '2026-11-19',         // used for recency in the editorial score
  TRANSLATION_MAX_MIN: 15,             // same author + nearest EN edition within 15 min
  PAIR_MAX_HOURS: 30,                  // two articles further apart are never the same event
  CLUSTER_MAX_SPAN_HOURS: 36,          // a cluster may not stretch beyond this (multi-day sagas split into events)
  MERGE_THRESHOLD: 0.30,               // average-link cosine needed to merge two clusters
  MERGE_THRESHOLD_PASS2: 0.20,         // lower bar, only between clusters that already have >= 2 articles each
  AMBIGUOUS_LOW: 0.20,
  ENTITY_BONUS: 0.08,                  // per shared named entity beyond the first (resists one-word bridges)
  ENTITY_BONUS_CAP: 0.16,
  EVENT_TYPE_BONUS: 0.05,              // same coarse event type (legal, leadership, macro_data, ...)
  EVENT_TYPE_PENALTY: 0.6,             // different event types: same company is not the same story                 // [LOW, THRESHOLD) + shared entity -> candidate for a cheap LLM check
  KEEP_TEXT_FOR_TABLE: true,
};

// ---------------------------------------------------------------------------
// 1. normalize
// ---------------------------------------------------------------------------
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
const FEED_BY_PUB = { 'Invezz': 'invezz_en', 'Invezz - German': 'invezz_de', 'Invezz - Dutch': 'invezz_nl', 'ActionForex': 'actionforex', 'International Business Times UK': 'ibtimes_uk', 'Zacks Investment Research': 'zacks' };

const seen = new Set();
const articles = [];
let skipped_no_id = 0, skipped_dup_id = 0;
for (const it of $input.all()) {
  const r = it.json;
  const id = r['$id'];
  if (!id) { skipped_no_id++; continue; }
  if (seen.has(id)) { skipped_dup_id++; continue; }
  seen.add(id);
  const text = clean(r.text_content);
  const pub = get(r, 'publication.name') || 'Unknown';
  articles.push({
    article_id: id,
    feed: FEED_BY_PUB[pub] || pub,
    publication: pub,
    permalink: r.permalink || null,
    language: (r.language || 'en').slice(0, 2),
    published_at: r.date,
    t: Date.parse(r.date),
    headline: clean(r.headline),
    excerpt: clean(r.excerpt),
    author: r.source || null,
    provider_categories: Array.isArray(r.provider_categories) ? r.provider_categories : [],
    tickers: Array.isArray(r.company_tickers) ? r.company_tickers : [],
    content_hash: 'cyrb53:' + cyrb53(text.toLowerCase()),
    text_len: text.length,
    text_content: text,
    role: null,            // anchor | member | translation | exact_copy | roundup | archive
    translation_of: null,
    copy_of: null,
    story_id: null,
  });
}
const fromT = Date.parse(CFG.GROUP_FROM);
for (const a of articles) if (!(a.t >= fromT)) a.role = 'archive';

// ---------------------------------------------------------------------------
// 2. exact copies (same cleaned body)
// ---------------------------------------------------------------------------
const byHash = {};
for (const a of articles) {
  if (a.text_len < 200) continue;
  if (byHash[a.content_hash]) { a.role = a.role === 'archive' ? 'archive' : 'exact_copy'; a.copy_of = byHash[a.content_hash].article_id; }
  else byHash[a.content_hash] = a;
}

// ---------------------------------------------------------------------------
// 3. translations: DE/NL -> nearest EN Invezz by same author within 15 min
// ---------------------------------------------------------------------------
const enInvezz = articles.filter(a => a.feed === 'invezz_en');
let translations_linked = 0, translations_unmatched = 0;
for (const a of articles) {
  if (a.language === 'en' || a.role === 'archive') continue;
  let best = null, bestD = Infinity;
  for (const e of enInvezz) {
    if (e.author !== a.author) continue;
    const d = Math.abs(e.t - a.t);
    if (d <= CFG.TRANSLATION_MAX_MIN * 60000 && d < bestD) { best = e; bestD = d; }
  }
  if (best) { a.role = 'translation'; a.translation_of = best.article_id; translations_linked++; }
  else translations_unmatched++; // stays a normal (non-English) article
}
// DE/NL editions whose EN original is missing: link NL -> DE (same author, within window)
for (const a of articles) {
  if (a.role || a.language !== 'nl') continue;
  const twin = articles.find(o => o.language === 'de' && !o.role && o.author === a.author && Math.abs(o.t - a.t) <= CFG.TRANSLATION_MAX_MIN * 60000);
  if (twin) { a.role = 'translation'; a.translation_of = twin.article_id; translations_linked++; translations_unmatched--; }
}
const outletFamily = pub => pub.replace(/ - (German|Dutch)$/, '');

// ---------------------------------------------------------------------------
// 4. roundups (digests): never anchor or merge
// ---------------------------------------------------------------------------
const ROUNDUP = /\b(evening digest|morning digest|digest:|\d+ things to know|things to know before|stock market news for|week ahead|weekly recap|market wrap|avondoverzicht|ochtendoverzicht|abend-report|morgen-report|dinge vor|dingen om te weten)\b/i;
for (const a of articles) if (!a.role && ROUNDUP.test(a.headline)) a.role = 'roundup';

// ---------------------------------------------------------------------------
// 5. features: TF-IDF over headline (x2) + excerpt + lead, entities, phase
// ---------------------------------------------------------------------------
const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your says said new over amid after says week day today friday thursday monday tuesday wednesday saturday sunday shares share stock stocks market markets price prices year years month percent per cent report reports reported what know things here how why now set top latest could may might one two three first last next back ahead per amid').split(' '));
const GENERIC_ENT = new Set(['US', 'U.S.', 'UK', 'Wall', 'Street', 'Stock', 'Stocks', 'Market', 'Markets', 'Dow', 'S&P', 'Nasdaq', 'ETF', 'ETFs', 'AI', 'CEO', 'The', 'This', 'Why', 'How', 'What', 'Is', 'Are', 'Can', 'Will', 'Friday', 'Thursday', 'Monday', 'Tuesday', 'Wednesday', 'Saturday', 'Sunday', 'Zacks', 'Rank', 'Q3', 'Q4', 'Analyst', 'Blog', 'Inc', 'Corp', 'Ltd', 'Here', 'After', 'As', 'In', 'On', 'For', 'To', 'Of', 'And', 'With', 'From', 'New', 'Report', 'Reports', 'Price', 'Prices', 'Today', 'Week', 'November', 'October']);
const tok = s => (s.toLowerCase().match(/[a-z0-9][a-z0-9&.\-']*[a-z0-9]|[a-z0-9]/g) || []).map(w => w.replace(/'s$/, '')).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
const GENERIC_LC = new Set([...GENERIC_ENT].map(w => w.toLowerCase()));
const entitiesOf = s => new Set((s.match(/\b([A-Z][a-zA-Z&.\-]+|[A-Z]{2,})\b/g) || []).map(w => w.toLowerCase().replace(/[.\-]+$/, '')).filter(w => !GENERIC_LC.has(w) && !STOP.has(w) && w.length > 1));
// Title-case headlines (IBTimes, Zacks) make every word look like a name: take names from excerpt + lead instead.
function articleEntities(a) {
  const body = a.excerpt + ' ' + a.text_content.slice(0, 400);
  const ents = entitiesOf(body);
  const hw = a.headline.split(/\s+/);
  const titleCase = hw.filter(w => /^[A-Z]/.test(w)).length / Math.max(1, hw.length) > 0.6;
  for (const e of entitiesOf(a.headline)) if (!titleCase || ents.has(e) || /^[A-Z]{2,}$/.test(e.toUpperCase()) && a.headline.includes(e.toUpperCase())) ents.add(e);
  return ents;
}
// Coarse event type from headline (else excerpt). Different primary types => unlikely the same event.
const EVENT_TYPES = [
  ['legal', /\b(lawsuit|class[- ]action|sued|sues|fraud|probe|investigation|charged|indicted|court|settlement|klage|rechtszaak)\b/i],
  ['leadership', /\b(resign\w*|steps? down|stepped down|exit|ousted|depart\w*|successor|interim (ceo|cfo|chief)|leadership|reinstat\w*|return as|comeback|war room|rücktritt|vertrek|aftreden)\b/i],
  ['macro_data', /\b(ppi|cpi|gdp|inflation|payrolls|jobs report|retail sales|pmi|producer prices?|consumer prices?|unemployment|wholesale)\b/i],
  ['central_bank', /\b(fed|ecb|boj|boe|rba|rbnz|boc|rate (hike|cut)s?|interest rates?|monetary policy)\b/i],
  ['earnings', /\b(earnings|quarterly results|revenue|guidance|eps|q[1-4] results)\b/i],
  ['deal', /\b(acqui\w+|merger|takeover|buyout|stake|ipo|listing)\b/i],
  // headline-only: "what moved afterwards" is its own story, not the event that moved it
  ['market_move', /\b(stocks?|shares|dow|nasdaq|s&p|futures|index|indices)\b.{0,40}\b(rise[sn]?|rises|fall(s|ing)?|fell|drop(s|ped)?|slide[sd]?|slips?|jump(s|ed)?|surge[sd]?|plunge[sd]?|tumble[sd]?|rall(y|ies|ied)|gain(s|ed)?|edge[sd]? (up|down|higher|lower)|rebound(s|ed)?)\b|\b(rise[sn]?|rises|fall(s|ing)?|fell|drop(s|ped)?|slide[sd]?|jump(s|ed)?|surge[sd]?|plunge[sd]?|tumble[sd]?)\b.{0,12}\d+(\.\d+)?\s?%/i, 'headline'],
];
// earliest mention wins (headline first, then excerpt): "fell after Nvidia cut its stake ... lawsuit" -> deal, not legal
const eventType = a => {
  for (const src of [a.headline, a.excerpt]) {
    let best = null, pos = Infinity;
    for (const [t, re, only] of EVENT_TYPES) { if (only === 'headline' && src !== a.headline) continue; const m = src.match(re); if (m && m.index < pos) { pos = m.index; best = t; } }
    if (best) return best;
  }
  return null;
};
const PREVIEW = /\b(ahead of|preview|what to expect|set to report|due to report|before (the )?(release|data|earnings)|awaits?|awaiting)\b/i;

const pool = articles.filter(a => !a.role && a.language === 'en'); // groupable: distinct, English, in range, not roundup
// non-English articles without EN counterpart are grouped too (their tokens rarely match; they will mostly stay singletons)
for (const a of articles) if (!a.role && a.language !== 'en') pool.push(a);

const df = {};
for (const a of pool) {
  a._tokens = [...tok(a.headline), ...tok(a.headline), ...tok(a.excerpt), ...tok(a.text_content.slice(0, 600))];
  for (const w of new Set(a._tokens)) df[w] = (df[w] || 0) + 1;
  a._ents = articleEntities(a);
  a._etype = eventType(a);
  for (const tk of a.tickers) a._ents.add(String(tk).toLowerCase());
  a._phase = PREVIEW.test(a.headline) ? 'preview' : 'event';
}
const N = pool.length;
for (const a of pool) {
  const tf = {};
  for (const w of a._tokens) tf[w] = (tf[w] || 0) + 1;
  let norm = 0; const vec = {};
  for (const [w, c] of Object.entries(tf)) { if (df[w] < 2) continue; const v = (1 + Math.log(c)) * Math.log(N / df[w]); vec[w] = v; norm += v * v; }
  norm = Math.sqrt(norm) || 1;
  for (const w in vec) vec[w] /= norm;
  a._vec = vec;
}
const cos = (x, y) => { let s = 0; const [a, b] = Object.keys(x).length < Object.keys(y).length ? [x, y] : [y, x]; for (const w in a) if (b[w]) s += a[w] * b[w]; return s; };
const sharedEnts = (a, b) => { let n = 0; for (const e of a._ents) if (b._ents.has(e)) n++; return n; };
const shareEnt = (a, b) => sharedEnts(a, b) > 0;

// ---------------------------------------------------------------------------
// 6. pairwise similarity with blocking (time + shared entity)
// ---------------------------------------------------------------------------
pool.sort((a, b) => a.t - b.t);
const sim = new Map(); // key "i|j"
const ambiguous = [];
let pairs_compared = 0;
for (let i = 0; i < pool.length; i++) {
  for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i], b = pool[j];
    if (b.t - a.t > CFG.PAIR_MAX_HOURS * 3600000) break;
    if (!shareEnt(a, b)) continue;
    pairs_compared++;
    let s = cos(a._vec, b._vec) + Math.min(CFG.ENTITY_BONUS_CAP, CFG.ENTITY_BONUS * (sharedEnts(a, b) - 1));
    if (a._phase !== b._phase) s *= 0.5; // a preview is not the result
    if (a._etype && b._etype) s = a._etype === b._etype ? s + CFG.EVENT_TYPE_BONUS : s * CFG.EVENT_TYPE_PENALTY;
    if (s > 0) sim.set(i + '|' + j, s);
    if (s >= CFG.AMBIGUOUS_LOW && s < CFG.MERGE_THRESHOLD && a.feed !== b.feed) ambiguous.push({ a: a.article_id, b: b.article_id, score: Number(s.toFixed(3)) });
  }
}
const S = (i, j) => sim.get(i < j ? i + '|' + j : j + '|' + i) || 0;

// ---------------------------------------------------------------------------
// 7. average-linkage agglomeration (resists bridge articles), with span cap
// ---------------------------------------------------------------------------
let clusters = pool.map((a, i) => ({ members: [i], tmin: a.t, tmax: a.t }));
const avgLink = (c1, c2) => { let s = 0; for (const i of c1.members) for (const j of c2.members) s += S(i, j); return s / (c1.members.length * c2.members.length); };
const owner = pool.map((_, i) => i); // index into clusters
let merged = true;
while (merged) {
  merged = false;
  // candidate cluster pairs = those connected by at least one similar pair
  const cand = new Map();
  for (const [k, s] of sim) {
    if (s < CFG.MERGE_THRESHOLD * 0.5) continue;
    const [i, j] = k.split('|').map(Number);
    const ci = owner[i], cj = owner[j];
    if (ci === cj) continue;
    const key = ci < cj ? ci + '|' + cj : cj + '|' + ci;
    if (!cand.has(key)) cand.set(key, [Math.min(ci, cj), Math.max(ci, cj)]);
  }
  let best = null, bestS = CFG.MERGE_THRESHOLD;
  for (const [ci, cj] of cand.values()) {
    const A = clusters[ci], B = clusters[cj];
    if (Math.max(A.tmax, B.tmax) - Math.min(A.tmin, B.tmin) > CFG.CLUSTER_MAX_SPAN_HOURS * 3600000) continue;
    const s = avgLink(A, B);
    if (s >= bestS) { bestS = s; best = [ci, cj]; }
  }
  if (best) {
    const [ci, cj] = best;
    const A = clusters[ci], B = clusters[cj];
    A.members.push(...B.members); A.tmin = Math.min(A.tmin, B.tmin); A.tmax = Math.max(A.tmax, B.tmax);
    for (const m of B.members) owner[m] = ci;
    clusters[cj] = { members: [], tmin: 0, tmax: 0 };
    merged = true;
  }
}
clusters = clusters.filter(c => c.members.length);
// core entities: named in at least half of a cluster's articles
const coreOf = c => { const n = {}; for (const i of c.members) for (const e of pool[i]._ents) n[e] = (n[e] || 0) + 1; return new Set(Object.keys(n).filter(e => n[e] * 2 >= c.members.length)); };
const shareCore = (A, B) => { const a = coreOf(A), b = coreOf(B); for (const e of a) if (b.has(e)) return true; return false; };
// pass 2: two established clusters (>= 2 articles each) describing the same event from different angles
let merged2 = true, pass2_merges = 0;
while (merged2) {
  merged2 = false;
  let best = null, bestS = CFG.MERGE_THRESHOLD_PASS2;
  for (let x = 0; x < clusters.length; x++) for (let y = x + 1; y < clusters.length; y++) {
    const A = clusters[x], B = clusters[y];
    if (A.members.length < 2 || B.members.length < 2) continue;
    if (!shareCore(A, B)) continue; // both clusters must be ABOUT the same named thing
    if (Math.max(A.tmax, B.tmax) - Math.min(A.tmin, B.tmin) > CFG.CLUSTER_MAX_SPAN_HOURS * 3600000) continue;
    const s2 = avgLink(A, B);
    if (s2 >= bestS) { bestS = s2; best = [x, y]; }
  }
  if (best) {
    const [x, y] = best; const A = clusters[x], B = clusters[y];
    A.members.push(...B.members); A.tmin = Math.min(A.tmin, B.tmin); A.tmax = Math.max(A.tmax, B.tmax);
    clusters.splice(y, 1); merged2 = true; pass2_merges++;
  }
}

// ---------------------------------------------------------------------------
// 8. build story records (+ attach translations, copies, roundups as singletons)
// ---------------------------------------------------------------------------
const byId = Object.fromEntries(articles.map(a => [a.article_id, a]));
const FEED_WEIGHT = { actionforex: 1.0, invezz_en: 1.0, ibtimes_uk: 0.9, zacks: 0.7 };
const briefT = Date.parse(CFG.BRIEFING_DATE + 'T06:00:00Z');
const stories = [];
function makeStory(members, kind) {
  members.sort((a, b) => a.t - b.t);
  const outlets = [...new Set(members.map(m => outletFamily(m.publication)))];
  // representative: longest text from the outlet with most weight, earliest on ties
  const rep = [...members].sort((a, b) => (FEED_WEIGHT[b.feed] || 0.5) - (FEED_WEIGHT[a.feed] || 0.5) || b.text_len - a.text_len)[0];
  const ents = {};
  for (const m of members) for (const e of (m._ents || [])) ents[e] = (ents[e] || 0) + 1;
  const topEnts = Object.entries(ents).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  const ageH = Math.max(0, (briefT - members[members.length - 1].t) / 3600000);
  const score = kind === 'roundup' ? 0 : Number((outlets.length * 1.0 + Math.log2(1 + members.length) * 0.5 + (FEED_WEIGHT[rep.feed] || 0.5) - Math.min(ageH, 96) / 48).toFixed(3));
  const story_id = 'sty_' + cyrb53(members.map(m => m.article_id).sort().join('|'));
  for (const m of members) { m.story_id = story_id; if (!m.role) m.role = m === rep ? 'anchor' : 'member'; }
  stories.push({
    story_id,
    kind,                                        // event | roundup
    title: rep.headline,                         // internal label only
    first_seen: members[0].published_at,
    last_seen: members[members.length - 1].published_at,
    outlets,
    independent_outlet_count: outlets.length,    // translations are NOT counted
    article_ids: members.map(m => m.article_id),
    representative_article_id: rep.article_id,
    entities: topEnts,
    provider_categories: [...new Set(members.flatMap(m => m.provider_categories))],
    phase: members.every(m => m._phase === 'preview') ? 'preview' : 'event',
    editorial_score: score,
    storyline_id: null,
  });
}
for (const c of clusters) makeStory(c.members.map(i => pool[i]), 'event');
for (const a of articles) if (a.role === 'roundup') makeStory([a], 'roundup');
// translations / copies inherit the story of their original
for (const a of articles) {
  const orig = a.translation_of ? byId[a.translation_of] : a.copy_of ? byId[a.copy_of] : null;
  if (orig && orig.story_id) a.story_id = orig.story_id;
}
const sById = Object.fromEntries(stories.map(s => [s.story_id, s]));
for (const a of articles) if ((a.role === 'translation' || a.role === 'exact_copy') && a.story_id) {
  const s = sById[a.story_id];
  (s.translation_ids = s.translation_ids || []).push(a.article_id);
}

// ---------------------------------------------------------------------------
// 9. storylines: event clusters on different days that share their top entity
// ---------------------------------------------------------------------------
const multi = stories.filter(s => s.kind === 'event' && s.entities.length);
let lineNo = 0;
for (const s of multi) {
  if (s.storyline_id) continue;
  const key = s.entities[0];
  const line = multi.filter(o => o.entities.slice(0, 2).includes(key));
  if (line.length > 1) { const id = 'line_' + key.toLowerCase().replace(/[^a-z0-9]+/g, '_'); for (const o of line) if (!o.storyline_id) o.storyline_id = id; lineNo++; }
}

// ---------------------------------------------------------------------------
// 10. output
// ---------------------------------------------------------------------------
stories.sort((a, b) => b.editorial_score - a.editorial_score);
const pub = a => {
  const o = { article_id: a.article_id, feed: a.feed, publication: a.publication, permalink: a.permalink, language: a.language,
    published_at: a.published_at, headline: a.headline, excerpt: a.excerpt, author: a.author, provider_categories: a.provider_categories,
    content_hash: a.content_hash, role: a.role, translation_of: a.translation_of, copy_of: a.copy_of, story_id: a.story_id, text_len: a.text_len };
  if (CFG.KEEP_TEXT_FOR_TABLE && a.role !== 'archive' && a.role !== 'translation' && a.role !== 'exact_copy') o.text_content = a.text_content; // internal only
  return o;
};
const roles = {};
for (const a of articles) roles[a.role || 'none'] = (roles[a.role || 'none'] || 0) + 1;
const eventStories = stories.filter(s => s.kind === 'event');
const report = {
  settings: CFG,
  files: ($input.first() && $input.first().json.__files) || null,
  input_rows: $input.all().length, articles: articles.length, skipped_no_id, skipped_dup_id,
  roles,
  translations_linked, translations_unmatched,
  groupable_articles: pool.length, pairs_compared,
  stories: eventStories.length,
  multi_article_stories: eventStories.filter(s => s.article_ids.length > 1).length,
  multi_outlet_stories: eventStories.filter(s => s.independent_outlet_count > 1).length,
  largest_story: Math.max(...eventStories.map(s => s.article_ids.length)),
  storylines: [...new Set(stories.map(s => s.storyline_id).filter(Boolean))].length,
  pass2_merges,
  ambiguous_pairs_for_llm: ambiguous.length,
  ambiguous_pairs_sample: ambiguous.slice(0, 20),
  llm_calls_used: 0,
};

return [
  ...stories.map(s => ({ json: { _type: 'story', ...s } })),
  ...articles.map(a => ({ json: { _type: 'article', ...pub(a) } })),
  { json: { _type: 'report', ...report } },
];
