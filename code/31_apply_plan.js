// ============================================================================
// WORKFLOW B — NODE: "Select stories"   (Code node, Run Once for All Items)
// Applies the PLANNER's decision. Code only enforces integrity, not taste:
//   - every planned story exists in today's catalog (news window, no advice, text available)
//   - no story twice, reserves are not also in the plan
//   - today's picks stay in (added as quick hits if the planner left one out)
//   - total length roughly fits (word budgets are scaled, never stories removed for taste)
// How much time a company or topic gets is the planner's call.
// If the planner failed or returned nothing usable -> the rules-based fallback ranking.
// Output: { ...profile, plan: { selected, reserves, ... }, planner, to_extract, cached }.
// ============================================================================
const CFG = { SECOND_SOURCES: { main: 2, second: 1, background: 1, quick_hit: 0, reserve: 0 }, LENGTH_TOLERANCE: 0.2 };
const B = $('Build planner request').first().json;
const inp = $input.first().json;
const P = B.profile;
const J = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch (e) { return []; } };
const stories = Object.fromEntries($('Get stories').all().map(i => i.json).filter(s => s.story_id).map(s => [s.story_id, { ...s, outlets: J(s.outlets), article_ids: J(s.article_ids) }]));
const arts = Object.fromEntries($('Get articles').all().map(i => i.json).filter(a => a.article_id).map(a => [a.article_id, a]));
const cache = $('Get claim cache').all().map(i => i.json).filter(r => r.article_id && r.prompt_version === B.prompt_version);
const inCatalog = new Set(B.catalog.map(c => c.id));
const notes = [];

let planner = { mode: 'fallback', model: null, interpretation: null, wishes: [], listener_hooks: [], background_needed: [], error: null };
let planned = null, reserves = [];
let effectiveWords = B.target_words;
const usage = [...(B.usage || [])];
if (B.use_planner && inp.choices) {
  try {
    const ch = inp.choices[0];
    if (ch.finish_reason === 'length') throw new Error('planner output truncated');
    const raw = JSON.parse(ch.message.content);
    const u = inp.usage || {};
    usage.push({ stage: 'planner', model: inp.model, input_tokens: u.prompt_tokens || 0, cached_input_tokens: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0, output_tokens: u.completion_tokens || 0 });
    const seen = new Set();
    planned = [];
    for (const p of raw.plan || []) {
      if (!inCatalog.has(p.story_id)) { notes.push(`planner named ${p.story_id}, which is not in today's catalog - skipped`); continue; }
      if (seen.has(p.story_id)) continue;
      seen.add(p.story_id);
      planned.push({ story_id: p.story_id, role: ['main', 'second', 'quick_hit', 'background'].includes(p.role) ? p.role : 'second', angle: String(p.angle || ''), why_for_listener: String(p.why_for_listener || ''), target_words: Math.max(15, Math.min(900, Number(p.target_words) || 60)), read: (p.read_article_ids || []).map(String) });
    }
    reserves = [...new Set((raw.reserves || []).filter(id => inCatalog.has(id) && !seen.has(id)))];
    const catIds = new Set(B.catalog.map(c => c.id));
    const bc = ['pip', 'tide', 'flo', 'brook', 'rain'].includes(raw.better_character) && raw.better_character !== (P.character && P.character.id) ? raw.better_character : null;
    planner = { mode: 'planner', model: inp.model, interpretation: String(raw.interpretation || ''), error: null, better_character: bc, short_reason: String(raw.short_reason || '').trim().slice(0, 300) || null,
      listener_hooks: (raw.listener_hooks || []).slice(0, 3).map(String), background_needed: (raw.background_needed || []).slice(0, 2).map(String),
      wishes: (raw.wishes || []).map(w => ({ wish: w.wish, source: w.source, covered_by: (w.covered_by || []).filter(id => catIds.has(id)), note: w.note })) };
    if (!planned.length) { planner.error = 'planner returned no usable stories'; planned = null; }
  } catch (e) { planner.error = 'planner output unusable: ' + e.message; planned = null; }
} else if (B.use_planner) {
  planner.error = 'planner call failed' + (inp.error ? ': ' + String(inp.error.message || inp.error).slice(0, 200) : '');
}

// ---- integrity: today's picks stay in -----------------------------------------------------------
if (planned) {
  for (const id of P.pinned_story_ids || []) {
    if (!inCatalog.has(id) || planned.some(p => p.story_id === id)) continue;
    planned.push({ story_id: id, role: 'quick_hit', angle: stories[id] ? stories[id].title : id, why_for_listener: 'you picked this story for today', target_words: 35 });
    reserves = reserves.filter(r => r !== id);
    notes.push(`added your pick ${id}, which the planner had left out`);
  }
  // ---- integrity: length roughly fits (scale budgets, keep the planner's proportions) -------------
  const want = B.target_words - 30;
  const sum = planned.reduce((a, p) => a + p.target_words, 0);
  if (planner.short_reason && sum < want) {
    // the host has less fitting news than the length: shorter on purpose, never padded
    effectiveWords = sum + 30;
    notes.push(`planned ${sum} words instead of ${want}: ${planner.short_reason}`);
  } else if (sum && Math.abs(sum - want) / want > CFG.LENGTH_TOLERANCE) {
    const f = want / sum;
    planned.forEach(p => { p.target_words = Math.max(15, Math.round(p.target_words * f)); });
    notes.push(`word budgets scaled by ${f.toFixed(2)} to fit ${Math.round(P.duration_seconds / 60)} minutes (planner planned ${sum} words)`);
  }
}

// ---- build the plan in the shape the extraction / writer nodes expect -------------------------------
let selected, reserveList, to_extract = [], cached = [];
const fam = p => String(p || '').replace(/ - (German|Dutch)$/, '');
const need = (story_id, a) => {
  const hit = cache.find(r => r.article_id === a.article_id && r.content_hash === a.content_hash);
  const list = hit ? cached : to_extract;
  if (!list.some(x => x.article_id === a.article_id)) list.push({ story_id, article_id: a.article_id });
};
function sourcesFor(s, n) {
  const rep = arts[s.representative_article_id];
  const ids = [rep.article_id];
  const pubs = new Set([fam(rep.publication)]);
  const others = s.article_ids.map(id => arts[id]).filter(a => a && a.text_content && a.role !== 'translation' && a.article_id !== rep.article_id).sort((x, y) => y.text_len - x.text_len);
  for (const o of others) { if (ids.length > n) break; if (pubs.has(fam(o.publication))) continue; ids.push(o.article_id); pubs.add(fam(o.publication)); }
  return ids;
}
const storyArticle = (s, id) => arts[id] && arts[id].text_content && arts[id].role !== 'translation' && (s.article_ids.includes(id) || arts[id].story_id === s.story_id);
let readBudget = B.max_read || 14;
const toSel = (p, i, role) => {
  const s = stories[p.story_id];
  let src = (p.read || []).filter(id => storyArticle(s, id));
  if (!src.length) src = sourcesFor(s, CFG.SECOND_SOURCES[role] || 0);
  if (src.length > readBudget) { notes.push(`"${s.title}": ${src.length} articles asked, ${Math.max(1, readBudget)} read (cost cap for this length)`); src = src.slice(0, Math.max(1, readBudget)); }
  readBudget -= src.length;
  const covers = planner.wishes.filter(w => w.covered_by.includes(p.story_id)).map(w => w.wish);
  return { story_id: s.story_id, title: s.title, outlets: s.outlets, storyline_id: s.storyline_id, representative_article_id: s.representative_article_id, article_ids: s.article_ids,
    rank: i + 1, role, angle: p.angle || s.title, target_words: p.target_words || 35, pinned: (P.pinned_story_ids || []).includes(s.story_id),
    score: null, score_parts: null, why: [p.why_for_listener, covers.length ? 'covers: ' + covers.join(', ') : null, role === 'background' ? 'background from earlier this week' : null].filter(Boolean), source_article_ids: src };
};
if (planned) {
  selected = planned.map((p, i) => toSel(p, i, p.role));
  readBudget = Math.max(readBudget, 3); // reserves: one article each
  reserveList = reserves.slice(0, 4).map((id, i) => toSel({ story_id: id, angle: stories[id].title, why_for_listener: 'reserve: used if a planned story turns out thin', target_words: 35 }, i, 'reserve'));
  for (const s of [...selected, ...reserveList]) for (const id of s.source_article_ids) need(s.story_id, arts[id]);
} else {
  // rules-based fallback (old ranking): first story main, the rest quick hits/second
  const fb = B.fallback;
  selected = fb.plan.selected.map((s, i) => ({ ...s, role: i === 0 ? 'main' : i < 3 ? 'second' : 'quick_hit', angle: s.title, target_words: i === 0 ? Math.round(B.target_words * 0.4) : 50 }));
  reserveList = [];
  to_extract = fb.to_extract; cached = fb.cached;
  notes.push('used the rules-based fallback ranking');
}

return [{ json: { ...B, openai_body: undefined, fallback: undefined, usage,
  planner: { ...planner, notes },
  plan: { briefing_date: B.briefing_date, window_hours: B.window_hours, budget: { duration_seconds: P.duration_seconds, target_words: effectiveWords, requested_words: B.target_words, short_by_choice: effectiveWords < B.target_words, max_stories: selected.length },
    candidates: B.catalog.length, selected, reserves: reserveList, runners_up: reserveList.map(r => ({ title: r.title, score: null, why_not: 'reserve (not needed unless a planned story is thin)' })), excluded: B.excluded },
  to_extract, cached, prompt_version: B.prompt_version } }];
