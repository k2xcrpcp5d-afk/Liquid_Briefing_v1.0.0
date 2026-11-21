// ============================================================================
// WORKFLOW B v2 — NODE: "Verify facts"   (Code node, Run Once for All Items)
// The fact check before anything may be said: we read every source page ourselves.
// A fact passes only if (1) its source is on the trusted list, (2) the quote the
// research gave is really on that page (>= 80 % of 6-word windows verbatim), and
// (3) every number of the statement is on that page. Otherwise it is dropped.
// ============================================================================
const items = $('Collect sources').all();
const pages = $input.all();
const meta = items[0].json.meta;

function htmlToText(h) {
  h = String(h || '');
  const ld = [];
  h.replace(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, (m, j) => {
    try { const walk = x => { if (!x) return; if (Array.isArray(x)) return x.forEach(walk); if (typeof x === 'object') { if (typeof x.articleBody === 'string') ld.push(x.articleBody); Object.values(x).forEach(v => { if (typeof v === 'object') walk(v); }); } }; walk(JSON.parse(j)); } catch (e) {}
    return m;
  });
  let t = h.replace(/<(script|style|noscript|svg|nav|footer|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&bdquo;/g, '"').replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, '-').replace(/&[a-z]+;|&#\d+;/gi, ' ');
  return (ld.join(' ') + ' ' + t).replace(/\s+/g, ' ').trim();
}
const normText = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’‚‛′`´]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐-―−]/g, '-').replace(/[^a-z0-9%$€£.,'"\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = s => normText(s).replace(/["'.,]/g, ' ').split(' ').filter(Boolean);
function quoteScore(quote, pw) {
  const w = wordsOf(quote);
  if (w.length < 5) return w.length && pw.includes(' ' + w.join(' ') + ' ') ? 1 : 0;
  const wins = []; for (let i = 0; i + 6 <= w.length; i++) wins.push(w.slice(i, i + 6).join(' '));
  return wins.filter(x => pw.includes(' ' + x + ' ')).length / wins.length;
}
const numbersIn = s => { const out = []; String(s || '').replace(/(\d[\d.,  ']*\d|\d)/g, m => { out.push(m.replace(/[  ']/g, '').replace(/[.,]$/, '')); return m; }); return out.filter(x => !/^(19|20)\d\d$/.test(x)); };
function variants(x) {
  const v = [x, x.replace(/,/g, '.'), x.replace(/\./g, ','), x.replace(/[.,](?=\d{3}(\D|$))/g, '')];
  const n = parseFloat(x.replace(/,/g, '.').replace(/\.(?=\d{3}(\D|$))/g, ''));
  if (isFinite(n)) { v.push(String(n)); v.push(String(n).replace('.', ',')); }
  return v;
}
const missingNumbers = (statement, text) => { const t = ' ' + normText(text) + ' '; return numbersIn(statement).filter(x => !variants(x).some(y => t.includes(y))); };

const page = {};
items.forEach((it, i) => {
  const p = pages[i] ? pages[i].json : {};
  const txt = htmlToText(p.html || p.data || '');
  page[it.json.url] = { ok: !p.error && txt.length > 600, words: ' ' + wordsOf(txt).join(' ') + ' ', text: txt, error: p.error ? String(p.error.message || p.error).slice(0, 60) : null };
});

const claims = [], rejected = [];
for (const f of meta.facts) {
  let best = null; const why = [];
  for (const src of f.sources) {
    if (!src.allowed) { why.push(src.domain + ': not on the trusted list'); continue; }
    const pg = page[src.url];
    if (!pg || !pg.ok) { why.push(src.domain + ': page not readable'); continue; }
    const sc = quoteScore(src.quote, pg.words);
    if (sc < 0.8) { why.push(src.domain + ': quote not on the page (' + Math.round(sc * 100) + '%)'); continue; }
    const miss = missingNumbers(f.statement, src.quote + ' ' + pg.text);
    if (miss.length) { why.push(src.domain + ': number not on the page ' + miss.join(',')); continue; }
    if (!best || sc > best.score) best = { ...src, score: Number(sc.toFixed(2)) };
  }
  if (best) claims.push({ claim_id: f.id, story_key: f.story_key, angle: f.angle, statement: f.statement, kind: f.kind, attribution: f.attribution, date: f.date,
    source_url: best.url, publication: best.publisher || best.domain, domain: best.domain, quote: best.quote, match: best.score });
  else rejected.push({ claim_id: f.id, statement: f.statement, why });
}
const okIds = new Set(claims.map(c => c.claim_id));
const stories = meta.stories.map(s => ({ ...s, claim_ids: s.fact_ids.filter(id => okIds.has(id)) })).filter(s => s.claim_ids.length);
return [{ json: {
  stories, claims, rejected, usage: meta.usage, notes: meta.notes, answerable: meta.answerable,
  check: { facts_proposed: meta.facts.length, facts_verified: claims.length, pages_read: Object.values(page).filter(p => p.ok).length, pages_total: Object.keys(page).length, searches: meta.searches, ms_research: meta.ms_research },
  words: meta.words, factsTarget: meta.factsTarget,
} }];
