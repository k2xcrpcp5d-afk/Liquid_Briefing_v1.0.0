// ============================================================================
// WORKFLOW B — NODE: "Material check"   (Code node, Run Once for All Items)
// The planner chose stories before any facts existed. Now the facts are extracted
// and checked, so this step makes the plan fit the MATERIAL (no LLM):
//   - a story can only fill ~WORDS_PER_CLAIM words per verified fact (no padding)
//   - a full story with too few facts becomes a quick hit; a story with none is replaced by a reserve
//   - spare time goes to stories that have more material, then to reserve stories
// Every change is logged and shown on the page.
// Output: { stories: [{ story_id, role, angle, words, outlets, claims }], target_words, changes }.
// ============================================================================
const CFG = { WORDS_PER_CLAIM: 20, FRAMING_WORDS: 30, MIN_CLAIMS_FULL: 3, QUICK_HIT_WORDS: 35, MAX_CLAIMS_PER_STORY: 40, FIXED_WORDS: 40 };
// ~20 spoken words per verified fact; full stories also get ~30 words of framing (why it matters for you, background, transitions)
const S = $('Select stories').first().json;
const P = S.profile;
const newRows = $('Validate claims (batch)').all().map(i => i.json).filter(r => r.article_id);
const cacheRows = $('Get claim cache').all().map(i => i.json).filter(r => r.article_id && r.prompt_version === S.prompt_version);
const rowFor = id => newRows.find(r => r.article_id === id) || cacheRows.find(r => r.article_id === id);

function verifiedClaims(s) {
  const out = [], seen = new Set();
  for (const aid of s.source_article_ids || [s.representative_article_id]) {
    const row = rowFor(aid);
    for (const c of row ? JSON.parse(row.claims_json || '[]') : []) {
      if (c.status !== 'verified') continue;
      const key = c.statement.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key); out.push(c);
    }
  }
  return out.slice(0, CFG.MAX_CLAIMS_PER_STORY);
}
const changes = [];
const target = S.plan.budget.target_words - CFG.FIXED_WORDS;
const reserves = (S.plan.reserves || []).map(s => ({ ...s, claims: verifiedClaims(s) })).filter(s => s.claims.length).sort((a, b) => b.claims.length - a.claims.length);
const capacity = st => (st.role === 'quick_hit' ? Math.min(45, st.claims.length * CFG.WORDS_PER_CLAIM) : st.claims.length * CFG.WORDS_PER_CLAIM + CFG.FRAMING_WORDS);

let plan = [];
for (const s of S.plan.selected) {
  const claims = verifiedClaims(s);
  let st = { ...s, claims, words: s.target_words };
  if (!claims.length) {
    const r = reserves.shift();
    if (r) { changes.push(`"${s.title}" had no verified facts - replaced by reserve "${r.title}"`); st = { ...r, role: s.role === 'quick_hit' || r.claims.length < CFG.MIN_CLAIMS_FULL ? 'quick_hit' : s.role, words: s.target_words, why: [...(r.why || []), `replaces "${s.title}"`] }; }
    else { changes.push(`"${s.title}" had no verified facts - dropped (no reserve left)`); continue; }
  } else if (st.role !== 'quick_hit' && claims.length < CFG.MIN_CLAIMS_FULL) {
    changes.push(`"${s.title}" has only ${claims.length} verified fact(s) - told as a quick hit`);
    st.role = 'quick_hit';
  }
  plan.push(st);
}
// words follow material
for (const st of plan) {
  const cap = capacity(st);
  const want = st.role === 'quick_hit' ? Math.min(st.words, CFG.QUICK_HIT_WORDS + 10) : st.words;
  if (cap < want) changes.push(`"${st.title}": ${want} words planned, material for about ${cap}`);
  st.words = Math.max(15, Math.min(want, cap));
}
let sum = () => plan.reduce((a, s) => a + s.words, 0);
// spare time -> stories with more material (planner's order = priority)
let deficit = target - sum();
for (const st of plan) {
  if (deficit <= 10) break;
  if (st.role === 'quick_hit') continue;
  const room = capacity(st) - st.words;
  if (room > 10) { const add = Math.min(room, deficit); st.words += add; deficit -= add; }
}
// still short -> reserves (as quick hits or full stories, depending on their material)
while (target - sum() > target * 0.12 && reserves.length) {
  const r = reserves.shift();
  const full = r.claims.length >= CFG.MIN_CLAIMS_FULL && target - sum() > 80;
  const st = { ...r, role: full ? 'second' : 'quick_hit', words: 0, why: [...(r.why || []), 'added to fill the length'] };
  st.words = Math.min(capacity(st), full ? target - sum() : CFG.QUICK_HIT_WORDS);
  plan.push(st);
  changes.push(`added reserve "${r.title}" (${st.role}) to fill the length`);
}
if (target - sum() > target * 0.12) changes.push(`only enough verified material for about ${Math.round((sum() + CFG.FIXED_WORDS) / 2.5)} seconds of the planned ${P.duration_seconds}`);
// the lead goes first
plan.sort((a, b) => (a.role === 'main' ? 0 : 1) - (b.role === 'main' ? 0 : 1));
if (plan.length && !plan.some(s => s.role === 'main')) { const best = plan.find(s => s.role === 'second'); if (best) best.role = 'main'; }

// give the writer exactly the facts that fit its word budget (it must use all of them): strongest facts, article order kept
const PRIO = { data_release: 1, company_result: 1, policy_decision: 1, upcoming_event: 2, context: 2, price_move: 3, forecast_or_estimate: 3, attributed_view: 4, other_fact: 5 };
for (const st of plan) {
  const n = Math.max(1, Math.round((st.words - (st.role === 'quick_hit' ? 0 : CFG.FRAMING_WORDS)) / CFG.WORDS_PER_CLAIM));
  if (st.claims.length <= n) continue;
  // explainer: facts without numbers first (story before figures); desk: figures first
  const figRank = c => (P.format === 'explainer' ? (c.figure ? 1 : 0) : P.format === 'desk' ? (c.figure ? 0 : 1) : 0);
  const keep = new Set(st.claims.map((c, i) => ({ c, i })).sort((a, b) => figRank(a.c) - figRank(b.c) || (PRIO[a.c.claim_type] || 9) - (PRIO[b.c.claim_type] || 9) || a.i - b.i).slice(0, n).map(x => x.c.claim_id));
  st.claims = st.claims.filter(c => keep.has(c.claim_id));
}
const stories = plan.map(s => ({
  story_id: s.story_id, title: s.title, role: s.role, angle: s.angle, words: Math.round(s.words), outlets: s.outlets, why: s.why,
  claims: s.claims.map(x => ({ claim_id: x.claim_id, statement: x.statement, type: x.claim_type, attribution: x.attribution, source: x.publication,
    figure: x.figure ? { value_text: x.figure.value_text, basis: x.figure.comparison_basis, measure: x.figure.measure, period: x.figure.period } : null })),
}));
return [{ json: { stories, target_words: S.plan.budget.target_words, planned_words: sum() + CFG.FIXED_WORDS, changes, unused_reserves: reserves.map(r => r.story_id) } }];
