// ============================================================================
// WORKFLOW B — NODE: "Check lengths"   (Code node, Run Once for All Items)
// Measures every written part against its word target. A part that came out more than
// 15% short gets ONE expansion request (same writer, its draft + facts it did not use yet).
// Output: one item per expansion request { expand: true, part, openai_body } - or a single { expand: false }.
// ============================================================================
const CFG = { MIN_SHARE: 0.85 };
const reqs = $('Build writer request').all().map(i => i.json);
const resps = $('OpenAI script writer').all().map(i => i.json);
const countWords = segs => segs.reduce((n, sg) => n + String(sg.text || '').split(/\s+/).filter(Boolean).length, 0);
const out = [];
reqs.forEach((req, k) => {
  if (!req.use_writer) return;
  const ch = ((resps[k] || {}).choices || [])[0];
  let segs = [];
  try { segs = JSON.parse(ch.message.content).segments || []; } catch (e) { segs = []; }
  const words = countWords(segs);
  if (!segs.length || words >= req.part_words * CFG.MIN_SHARE) return;
  const used = new Set(segs.flatMap(sg => sg.claim_ids || []));
  const partStories = req.stories.filter(st => req.part_story_ids.includes(st.story_id));
  const unused = partStories.flatMap(st => st.claims.filter(c => !used.has(c.claim_id)).map(c => ({ story_id: st.story_id, claim_id: c.claim_id, statement: c.statement, attribution: c.attribution })));
  const body = JSON.parse(JSON.stringify(req.openai_body));
  body.messages.push({ role: 'assistant', content: ch.message.content });
  body.messages.push({ role: 'user', content: `Your part has ${words} words; the target is ${req.part_words}. Rewrite the WHOLE part (same segment format, same duties) so it reaches between ${Math.round(req.part_words * 0.9)} and ${Math.round(req.part_words * 1.1)} words. Keep every fact you already used. Add these facts you have not used yet: ${JSON.stringify(unused)}. Tell more of the story: context, comparisons between the given facts, what it means for the listener, background concepts. Still no invented facts, no outlet names, no talk about sources.` });
  out.push({ json: { expand: true, part: req.part, words_before: words, target: req.part_words, openai_body: body } });
});
return out.length ? out : [{ json: { expand: false } }];
