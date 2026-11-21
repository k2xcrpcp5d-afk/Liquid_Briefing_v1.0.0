// ============================================================================
// WORKFLOW B — NODE: "Merge drafts"   (Code node, Run Once for All Items)
// Puts the written parts back together in plan order; an expanded version replaces the
// first draft when it is longer. Output: one item { merged, segments, usage, parts_report, writer_error }.
// ============================================================================
const reqs = $('Build writer request').all().map(i => i.json);
const resps = $('OpenAI script writer').all().map(i => i.json);
const checks = $('Check lengths').all().map(i => i.json);
const exp = $input.all().map(i => i.json);
const fromExpand = exp.some(e => e.choices);
const countWords = segs => segs.reduce((n, sg) => n + String(sg.text || '').split(/\s+/).filter(Boolean).length, 0);
const parse = r => { try { const ch = (r.choices || [])[0]; if (!ch || ch.finish_reason === 'length') return null; return JSON.parse(ch.message.content).segments || null; } catch (e) { return null; } };
const usageOf = (r, stage) => { const u = r.usage || {}; return { stage, model: r.model, input_tokens: u.prompt_tokens || 0, cached_input_tokens: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0, output_tokens: u.completion_tokens || 0 }; };
const usage = [], report = [], segments = [];
let failed = 0;
reqs.forEach((req, k) => {
  if (!req.use_writer) return;
  let segs = parse(resps[k] || {});
  if (resps[k] && resps[k].usage) usage.push(usageOf(resps[k], 'script_writer'));
  const words0 = segs ? countWords(segs) : 0;
  let expanded = false;
  if (fromExpand) {
    const ci = checks.findIndex(c => c.expand && c.part === req.part);
    if (ci >= 0 && exp[ci]) {
      if (exp[ci].usage) usage.push(usageOf(exp[ci], 'script_expand'));
      const e = parse(exp[ci]);
      if (e && countWords(e) > words0) { segs = e; expanded = true; }
    }
  }
  if (!segs) { failed++; return; }
  // each part has its duty: hook/teaser only in the lead part, recap/closer only in the last part
  const isFirst = req.part === 0, isLast = req.part === req.parts - 1;
  segs = segs.map(sg => (!isFirst && sg.kind === 'hook' ? { ...sg, kind: 'story' } : sg))
    .filter(sg => (isFirst || sg.kind !== 'teaser') && (isLast || !['recap', 'closer'].includes(sg.kind)));
  report.push({ part: req.part, stories: req.part_story_ids, target: req.part_words, words_first_draft: words0, words: countWords(segs), expanded });
  segments.push(...segs);
});
// the same sentence twice (e.g. a generic "for you" line in several parts) is said once
const seenText = new Set();
const words = t => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));
const similar = (a, b) => { const A = words(a), B = words(b); const inter = [...A].filter(w => B.has(w)).length; return inter / Math.max(1, Math.min(A.size, B.size)) >= 0.5; };
const keptBackground = [];
let forYou = 0;
const deduped = segments.filter(sg => {
  const k = String(sg.text || '').trim().toLowerCase();
  if (seenText.has(k)) return false;
  seenText.add(k);
  // background explained once: drop a background segment that repeats an earlier one
  if (sg.kind === 'background') { if (keptBackground.some(b => similar(b, sg.text))) return false; keptBackground.push(sg.text); }
  // "what this means for you": at most one per three minutes of briefing
  if (sg.kind === 'for_you') { forYou++; if (forYou > Math.max(1, Math.round((reqs[0] && reqs[0].target_words ? reqs[0].target_words : 450) / 450))) return false; }
  return true;
});
return [{ json: { merged: true, segments: deduped, usage, parts_report: report, writer_error: failed ? `${failed} part(s) failed` : null } }];
