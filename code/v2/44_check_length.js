// ============================================================================
// WORKFLOW B v2 — NODE: "Check length"   (Code node, Run Once for All Items)
// Models write short. If the draft is under 90 % of the chosen length, one extra call
// adds segments (more context and side facts from the verified claims) in the right places.
// ============================================================================
const R = $input.first().json;
const WR = $('Writer request').first().json;
const V = $('Verify facts').first().json;
const count = s => String(s || '').split(/\s+/).filter(Boolean).length;
let draft, error = null;
try { draft = JSON.parse(R.choices[0].message.content); } catch (e) { error = 'writer returned no JSON'; draft = { title: '', segments: [] }; }
const usage = R.usage ? [{ stage: 'script_writer', model: R.model || WR.openai_body.model, input_tokens: R.usage.prompt_tokens || 0, cached_input_tokens: (R.usage.prompt_tokens_details && R.usage.prompt_tokens_details.cached_tokens) || 0, output_tokens: R.usage.completion_tokens || 0 }] : [];
const words = draft.segments.reduce((a, s) => a + count(s.text), 0);
const used = new Set(draft.segments.flatMap(s => s.claim_ids));
const unused = V.claims.filter(c => !used.has(c.claim_id)).map(c => ({ claim_id: c.claim_id, story: c.story_key, statement: c.statement, attribution: c.attribution, date: c.date }));
const missing = WR.lo - words;
const needs_expand = !error && words < WR.words_target * 0.9 && (unused.length > 0 || missing > 40);
let openai_body = null;
if (needs_expand) {
  const SYSTEM = WR.openai_body.messages[0].content + `\nTASK NOW: the draft below is ${words} words, but the episode needs ${WR.lo}-${WR.hi}. Add about ${missing + 20} spoken words as NEW segments. Put each one right after the segment it continues (insert_after = that segment's index). Use the unused facts first (cite them), then go deeper into the stories with the facts already cited. Same voice, same rules. Do not repeat what is already said.`;
  const SCHEMA = { type: 'object', additionalProperties: false, required: ['additions'], properties: { additions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['insert_after', 'kind', 'story_key', 'text', 'claim_ids'], properties: {
    insert_after: { type: 'integer' }, kind: { type: 'string', enum: ['answer', 'story', 'context', 'side', 'explainer', 'transition', 'reaction', 'closer'] }, story_key: { type: ['string', 'null'] }, text: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } } } } } } };
  const user = JSON.parse(WR.openai_body.messages[1].content);
  openai_body = { model: WR.openai_body.model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ draft: draft.segments.map((s, i) => ({ index: i, kind: s.kind, story_key: s.story_key, text: s.text, claim_ids: s.claim_ids })), unused_facts: unused, all_claims: user.claims }, null, 1) }],
    response_format: { type: 'json_schema', json_schema: { name: 'additions', strict: true, schema: SCHEMA } }, max_completion_tokens: 12000 };
  if (WR.openai_body.reasoning_effort) openai_body.reasoning_effort = WR.openai_body.reasoning_effort;
}
return [{ json: { draft, words_first_draft: words, needs_expand, openai_body, writer_error: error, llm_usage: usage } }];
