// ============================================================================
// WORKFLOW E — NODE: "Archive rows"   (Code node, Run Once for All Items)
// Adds the articles OLDER than Workflow A's grouping window (Zacks, 28 Jul - 11 Nov) to lb_articles,
// one single-article story each (phase 'archive'), so a listener's question can find them by search.
// No LLM, no grouping. Run once; it stops if archive rows already exist.
// ============================================================================
const CFG = { GROUP_FROM: '2026-11-12T00:00:00Z' };
if ($('Existing stories').all().some(i => i.json.phase === 'archive')) throw new Error('Archive rows already exist in lb_stories - nothing to do (delete rows with phase = archive first to re-import).');
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
for (const it of $('Parse JSONL').all()) {
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

const ROUNDUP = /\b(evening digest|morning digest|digest:|\d+ things to know|things to know before|stock market news for|week ahead|weekly recap|market wrap|avondoverzicht|ochtendoverzicht|abend-report|morgen-report|dinge vor|dingen om te weten)\b/i;
const fromT = Date.parse(CFG.GROUP_FROM);
const J = v => JSON.stringify(v == null ? [] : v);
const seenHash = new Set();
const out = [];
let copies = 0;
for (const a of articles.filter(x => x.t < fromT).sort((x, y) => x.t - y.t)) {
  if (a.text_len >= 200 && seenHash.has(a.content_hash)) { copies++; continue; }
  seenHash.add(a.content_hash);
  const story_id = 'sty_' + cyrb53('archive|' + a.article_id);
  const roundup = ROUNDUP.test(a.headline);
  out.push({ json: { _type: 'story_row', story_id, kind: roundup ? 'roundup' : 'event', title: a.headline, first_seen: a.published_at, last_seen: a.published_at,
    outlets: J([a.publication]), independent_outlet_count: 1, article_count: 1, article_ids: J([a.article_id]), translation_ids: J([]), representative_article_id: a.article_id,
    entities: J([]), provider_categories: J(a.provider_categories), phase: 'archive', editorial_score: 0, storyline_id: null, check_status: 'archive', check_label: null, split_from: null } });
  out.push({ json: { _type: 'article_row', article_id: a.article_id, story_id, role: roundup ? 'roundup' : 'archive', feed: a.feed, publication: a.publication, permalink: a.permalink,
    language: a.language, published_at: a.published_at, headline: a.headline, excerpt: a.excerpt || null, author: a.author, provider_categories: J(a.provider_categories),
    content_hash: a.content_hash, translation_of: null, copy_of: null, text_len: a.text_len, text_content: a.text_content || null } });
}
out.push({ json: { _type: 'report', archive_articles: out.length / 2, exact_copies_skipped: copies, from: out.length ? out[0].json.first_seen : null, to: out.length ? out[out.length - 1].json.published_at : null } });
return out;
