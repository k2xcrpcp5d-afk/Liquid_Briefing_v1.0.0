// ============================================================================
// WORKFLOW B v2 — NODE: "Merge additions"   (Code node, Run Once for All Items)
// Inserts the extra segments from the length pass (if there was one) into the draft.
// ============================================================================
const L = $('Check length').first().json;
const R = $input.first().json;
const draft = { ...L.draft, segments: L.draft.segments.map(s => ({ ...s })) };
const usage = [...L.llm_usage];
let added = 0;
if (L.needs_expand && R && R.choices) {
  try {
    const adds = JSON.parse(R.choices[0].message.content).additions || [];
    if (R.usage) usage.push({ stage: 'script_expand', model: R.model, input_tokens: R.usage.prompt_tokens || 0, cached_input_tokens: (R.usage.prompt_tokens_details && R.usage.prompt_tokens_details.cached_tokens) || 0, output_tokens: R.usage.completion_tokens || 0 });
    // insert from the back so earlier indexes stay valid; never after the sign-off
    const last = draft.segments.length - 1;
    adds.sort((a, b) => b.insert_after - a.insert_after);
    for (const a of adds) {
      let at = Math.min(Math.max(-1, a.insert_after), last) + 1;
      while (at > 0 && at <= draft.segments.length && ['closer', 'signoff'].includes((draft.segments[at - 1] || {}).kind)) at--;
      draft.segments.splice(at, 0, { kind: a.kind, story_key: a.story_key, text: a.text, claim_ids: a.claim_ids });
      added++;
    }
  } catch (e) { /* keep the first draft */ }
}
return [{ json: { draft, words_first_draft: L.words_first_draft, added_segments: added, writer_error: L.writer_error, llm_usage: usage } }];
