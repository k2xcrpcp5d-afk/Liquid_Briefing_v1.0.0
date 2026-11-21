// ============================================================================
// NODE: "Apply checks & build rows"   (Code node, Run Once for All Items)
// Input: OpenAI cluster-check responses (or the single { skip } item).
// Splits clusters the model separated, then emits flat rows for the Data Tables:
//   _type 'story_row' -> lb_stories, _type 'article_row' -> lb_articles, plus one 'report'.
// ============================================================================
const grouped = $('Normalize, link & group').all().map(i => i.json);
const reqs = $('Prepare cluster checks').all().map(i => i.json);
const resps = reqs[0] && reqs[0].skip ? [] : $input.all().map(i => i.json);

const stories = grouped.filter(x => x._type === 'story');
const articles = grouped.filter(x => x._type === 'article');
const groupReport = grouped.find(x => x._type === 'report') || {};
const A = Object.fromEntries(articles.map(a => [a.article_id, a]));

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
const outletFamily = pub => pub.replace(/ - (German|Dutch)$/, '');
const FEED_WEIGHT = { actionforex: 1.0, invezz_en: 1.0, ibtimes_uk: 0.9, zacks: 0.7 };
const BRIEF_T = Date.parse((groupReport.settings ? groupReport.settings.BRIEFING_DATE : '2026-11-19') + 'T06:00:00Z');

function rebuild(parent, ids, status, label) {
  const members = ids.map(id => A[id]).sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
  const outlets = [...new Set(members.map(m => outletFamily(m.publication)))];
  const rep = [...members].sort((a, b) => (FEED_WEIGHT[b.feed] || 0.5) - (FEED_WEIGHT[a.feed] || 0.5) || b.text_len - a.text_len)[0];
  const ageH = Math.max(0, (BRIEF_T - Date.parse(members[members.length - 1].published_at)) / 3600000);
  const story_id = status === 'llm_split' ? 'sty_' + cyrb53(ids.slice().sort().join('|')) : parent.story_id;
  return {
    ...parent,
    story_id,
    title: rep.headline,
    first_seen: members[0].published_at,
    last_seen: members[members.length - 1].published_at,
    outlets,
    independent_outlet_count: outlets.length,
    article_ids: members.map(m => m.article_id),
    representative_article_id: rep.article_id,
    editorial_score: Number((outlets.length + Math.log2(1 + members.length) * 0.5 + (FEED_WEIGHT[rep.feed] || 0.5) - Math.min(ageH, 96) / 48).toFixed(3)),
    check_status: status,
    check_label: label || null,
    split_from: status === 'llm_split' ? parent.story_id : null,
  };
}

// ---- apply model decisions -------------------------------------------------------
const usage = [];
const checks = {};
resps.forEach((r, k) => {
  const req = reqs[k];
  const u = r.usage || {};
  usage.push({ stage: 'cluster_check', story_id: req.story_id, model: r.model, input_tokens: u.prompt_tokens || 0,
    cached_input_tokens: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0, output_tokens: u.completion_tokens || 0 });
  let parsed = null;
  try { parsed = JSON.parse(r.choices[0].message.content); } catch (e) { /* invalid -> keep */ }
  checks[req.story_id] = { parsed, checked_ids: req.checked_ids };
});

const finalStories = [];
let confirmed = 0, split = 0, invalid = 0;
for (const s of stories) {
  const c = checks[s.story_id];
  if (!c) { finalStories.push({ ...s, check_status: s.kind === 'roundup' ? 'roundup' : 'rules_only', check_label: null, split_from: null }); continue; }
  const n = c.checked_ids.length;
  const groups = (c.parsed && Array.isArray(c.parsed.groups)) ? c.parsed.groups.map(g => [...new Set(g.article_numbers)].filter(x => x >= 1 && x <= n)) : null;
  const flat = groups ? groups.flat() : [];
  const valid = groups && flat.length === n && new Set(flat).size === n;
  if (!valid) { invalid++; finalStories.push({ ...s, check_status: 'llm_invalid_kept', check_label: null, split_from: null }); continue; }
  if (groups.length === 1) { confirmed++; finalStories.push({ ...s, check_status: 'llm_confirmed', check_label: c.parsed.groups[0].event_label, split_from: null }); continue; }
  split++;
  // unchecked tail (clusters > MAX_ARTICLES_PER_CHECK) joins the largest group
  const tail = s.article_ids.slice(n);
  const order = groups.map((g, gi) => gi).sort((x, y) => groups[y].length - groups[x].length);
  groups.forEach((g, gi) => {
    const ids = g.map(x => c.checked_ids[x - 1]).concat(gi === order[0] ? tail : []);
    finalStories.push(rebuild(s, ids, 'llm_split', c.parsed.groups[gi].event_label));
  });
}

// story ids may have changed: point articles (and their translations) at the final story
const storyOf = {};
for (const s of finalStories) for (const id of s.article_ids) storyOf[id] = s.story_id;
for (const a of articles) {
  const base = a.translation_of || a.copy_of;
  a.story_id = storyOf[a.article_id] || (base && storyOf[base]) || a.story_id || null;
}
for (const s of finalStories) s.translation_ids = articles.filter(a => (a.role === 'translation' || a.role === 'exact_copy') && a.story_id === s.story_id).map(a => a.article_id);
finalStories.sort((a, b) => b.editorial_score - a.editorial_score);

// ---- flat rows (Data Tables accept no arrays/objects -> JSON strings) --------------
const J = v => JSON.stringify(v == null ? [] : v);
const storyRows = finalStories.map(s => ({ json: { _type: 'story_row',
  story_id: s.story_id, kind: s.kind, title: s.title, first_seen: s.first_seen, last_seen: s.last_seen,
  outlets: J(s.outlets), independent_outlet_count: s.independent_outlet_count, article_count: s.article_ids.length,
  article_ids: J(s.article_ids), translation_ids: J(s.translation_ids), representative_article_id: s.representative_article_id,
  entities: J(s.entities), provider_categories: J(s.provider_categories), phase: s.phase, editorial_score: s.editorial_score,
  storyline_id: s.storyline_id || null, check_status: s.check_status, check_label: s.check_label, split_from: s.split_from } }));
const articleRows = articles.filter(a => a.role !== 'archive').map(a => ({ json: { _type: 'article_row',
  article_id: a.article_id, story_id: a.story_id, role: a.role, feed: a.feed, publication: a.publication, permalink: a.permalink,
  language: a.language, published_at: a.published_at, headline: a.headline, excerpt: a.excerpt || null, author: a.author,
  provider_categories: J(a.provider_categories), content_hash: a.content_hash, translation_of: a.translation_of, copy_of: a.copy_of,
  text_len: a.text_len, text_content: a.text_content || null } }));

const price = { input_per_1m: 0.25, cached_input_per_1m: 0.025, output_per_1m: 2.0 }; // gpt-5-mini list price, VERIFY
const tokIn = usage.reduce((x, r) => x + r.input_tokens, 0), tokC = usage.reduce((x, r) => x + r.cached_input_tokens, 0), tokOut = usage.reduce((x, r) => x + r.output_tokens, 0);
const report = { _type: 'report',
  grouping: { ...groupReport, _type: undefined, ambiguous_pairs_sample: undefined },
  cluster_check: { mode: resps.length ? 'llm' : 'rules_only', checked: resps.length, confirmed, split, invalid,
    input_tokens: tokIn, cached_input_tokens: tokC, output_tokens: tokOut,
    est_cost_usd: Number((((tokIn - tokC) * price.input_per_1m + tokC * price.cached_input_per_1m + tokOut * price.output_per_1m) / 1e6).toFixed(5)) },
  final_stories: finalStories.filter(s => s.kind === 'event').length,
  final_multi_outlet_stories: finalStories.filter(s => s.kind === 'event' && s.independent_outlet_count > 1).length,
  rows: { stories: storyRows.length, articles: articleRows.length },
  usage_rows: usage,
};
return [...storyRows, ...articleRows, { json: report }];
