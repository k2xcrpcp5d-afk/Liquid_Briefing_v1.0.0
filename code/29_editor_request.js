// ============================================================================
// WORKFLOW B — NODE: "Build editor request"   (Code node, Run Once for All Items)
// The EDITOR is an independent agent that decides what is worth the airtime:
// given the length and the listener, it picks the main story (the one that
// explains the most without needing much background), optional quick hits, and
// the verified claims that carry the story (what happened, why it matters, what's next).
// It cuts everything else and says why. The writer only gets the editor's plan.
// Output: one item { use_editor, candidates, target_words, slots, openai_body? }.
// ============================================================================
const EDITOR = {
  USE_LLM_EDITOR: true,
  OPENAI_MODEL: 'gpt-5-mini',
  REASONING_EFFORT: 'low',
  WORDS_PER_SECOND: 2.5,
  MAX_CLAIMS_PER_STORY: 12,
};
const S = $('Select stories').first().json;
const P = S.profile;
const newRows = $('Validate claims (batch)').all().map(i => i.json).filter(r => r.article_id);
const cacheRows = $('Get claim cache').all().map(i => i.json).filter(r => r.article_id && r.prompt_version === S.prompt_version);
const rowFor = id => newRows.find(r => r.article_id === id) || cacheRows.find(r => r.article_id === id);

const candidates = [];
for (const s of S.plan.selected) {
  const claims = [];
  const seen = new Set();
  for (const aid of (s.source_article_ids || [s.representative_article_id])) {
    const row = rowFor(aid);
    for (const c of (row ? JSON.parse(row.claims_json || '[]') : [])) {
      if (c.status !== 'verified') continue;
      const key = c.statement.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push(c);
    }
  }
  if (!claims.length) continue;
  candidates.push({ story_id: s.story_id, rank: s.rank, pinned: !!s.pinned, headline: s.title, outlets: s.outlets, why_selected: s.why, claims: claims.slice(0, EDITOR.MAX_CLAIMS_PER_STORY) });
}
// spoken words for the whole briefing (no intro/outro templates any more)
const target_words = Math.round(P.duration_seconds * EDITOR.WORDS_PER_SECOND);
const slots = S.plan.budget.slots;
const base = { candidates, target_words, slots };
if (!EDITOR.USE_LLM_EDITOR || !candidates.length) return [{ json: { use_editor: false, reason: candidates.length ? 'editor disabled' : 'no verified claims', ...base } }];

const SYSTEM = `You are the EDITOR of a short personal audio news briefing. You do not write the script. You decide what is worth the listener's time.

Principles:
- A few stories told well beat many stories told badly. With little time, keep ONE main story and cut side topics.
- The MAIN story is the development that matters most for this listener AND can be understood without much background. If the listener asked a question, the main story answers it.
- A story is only worth including if its claims can carry: what happened, why it matters (scale, comparison, record, precedent, consequence) and, if available, what happens next. A story with only isolated numbers and no context is a cut or at most a one-sentence quick hit.
- Quick hits are single-sentence items that are important on their own.
- Length decides the shape: up to 3 minutes = ONE main story + at most 2 quick hits. About 5 minutes = up to 2 main stories + up to 3 quick hits. About 10 minutes = up to 4 main stories + up to 4 quick hits. Fewer is fine when the material is thin.
- Stories marked "picked_by_listener" were chosen by the listener for today: include every one of them (main story or quick hit), unless it has no usable claims.
- If the listener has little time today ("busy"), prefer one strong main story and quick hits; if they want "just the facts", prefer stories whose claims are concrete facts over views and forecasts.
- Pick for each included story only the claims that carry its angle, in the order they should be told. Never pick claims that just repeat each other.
- Word budget: main stories share about 75-85 percent of the total, quick hits about 15-25 words each, plus about 30 words for greeting, opening and closing. Total = target words.

Return the plan. "angle" is one sentence: the narrative thread for that story (what makes it interesting for THIS listener). "arc" is one sentence for the whole briefing. Every story you do not include goes into "cut" with a short reason.`;

const user = JSON.stringify({
  listener: { question: P.listener_question || null, focus: P.focus, companies_followed: P.entities, topics: P.topics, expertise: P.expertise, region: P.region, identity: P.identity || null, busy_today: !!(P.style && P.style.busy), just_the_facts: !!(P.style && P.style.facts_only) },
  length_seconds: P.duration_seconds, target_words, suggested_max_stories: slots,
  candidates: candidates.map(c => ({ story_id: c.story_id, picked_by_listener: c.pinned, headline: c.headline, outlets: c.outlets, claims: c.claims.map(x => ({ claim_id: x.claim_id, type: x.claim_type, statement: x.statement })) })),
}, null, 1);

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['arc', 'stories', 'cut'],
  properties: {
    arc: { type: 'string' },
    stories: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['story_id', 'role', 'angle', 'claim_ids', 'words'],
      properties: { story_id: { type: 'string' }, role: { type: 'string', enum: ['main', 'quick_hit'] }, angle: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } }, words: { type: 'integer' } } } },
    cut: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['story_id', 'why'], properties: { story_id: { type: 'string' }, why: { type: 'string' } } } },
  },
};
const body = {
  model: EDITOR.OPENAI_MODEL,
  messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
  response_format: { type: 'json_schema', json_schema: { name: 'editor_plan', strict: true, schema: SCHEMA } },
  max_completion_tokens: 8000,
};
if (/^(gpt-5|o\d)/.test(EDITOR.OPENAI_MODEL) && EDITOR.REASONING_EFFORT) body.reasoning_effort = EDITOR.REASONING_EFFORT;
return [{ json: { use_editor: true, ...base, openai_body: body } }];
