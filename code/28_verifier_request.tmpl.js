// ============================================================================
// WORKFLOW B — NODE: "Check script & build verifier request"   (Code node)
// 1) Parses the writer's script and runs the deterministic checks per segment
//    (cites verified claims, every number appears in the cited evidence, no advice,
//    no unattributed causes, no numbers in bridges/explainers). Failing segments are DROPPED.
// 2) Builds one request for a second model that reads each remaining segment against
//    its claims and flags anything the sources do not say.
// Output: one item { writer_ok, segments, dropped, openai_body? , skip_verifier }.
// ============================================================================
const VERIFY = { USE_LLM_VERIFIER: true, OPENAI_MODEL: 'gpt-5-mini', REASONING_EFFORT: 'low' }; // checks AND repairs: unsupported segments come back rewritten from their claims
const W = $('Build writer request').first().json;
const resp = $input.first().json;

/*__GATE_HELPERS__*/

const claimById = {};
for (const st of W.stories) for (const c of st.claims) claimById[c.claim_id] = { ...c, story_id: st.story_id };
// full claim records (with evidence) for the number check
const S = $('Select stories').first().json;
const newRows = $('Validate claims (batch)').all().map(i => i.json).filter(r => r.article_id);
const cacheRows = $('Get claim cache').all().map(i => i.json).filter(r => r.article_id && r.prompt_version === S.prompt_version);
const full = {};
for (const r of [...cacheRows, ...newRows]) for (const c of JSON.parse(r.claims_json || '[]')) full[c.claim_id] = c;

let parsed = null, writer_error = null, usage = null, writerUsage = [], partsReport = [];
if (!W.use_writer) writer_error = W.reason;
else if (resp.merged) {
  parsed = { segments: resp.segments || [] };
  writer_error = resp.writer_error || null;
  writerUsage = resp.usage || [];
  partsReport = resp.parts_report || [];
} else writer_error = 'writer output missing';
const editorUsage = writerUsage;
if (!parsed || !Array.isArray(parsed.segments) || !parsed.segments.length) {
  return [{ json: { writer_ok: false, writer_error: writer_error || 'empty script', segments: [], dropped: [], skip_verifier: true, usage: [...editorUsage] } }];
}

// meta commentary the listener should never hear
const CHAR = (S.profile && S.profile.character) || { name: 'the host', never: [] };
const NEVER = CHAR.never || [];
const HOST = CHAR.name;
const LG = (S.profile && S.profile.language) || 'en';
const LG_NAME = { en: 'English', de: 'German', nl: 'Dutch' }[LG];
const neverRe = w => new RegExp('(^|[^a-z])' + w.replace(/[^a-z ]/gi, '') + '($|[^a-z])', 'i');
const META = /\b(we (cannot|can't|can not) (verify|confirm)|(können|konnten) (wir )?(das )?nicht (überprüfen|bestätigen|verifizieren)|nicht verifiziert|kunnen (we )?(dit )?niet (verifiëren|bevestigen|controleren)|niet geverifieerd|primary sources?|the material (available|here|provided)|(does|do) not establish|is not established|from the (material|sources) available|not (yet )?verified|cannot be verified)\b/i;
const outletCount = {};
for (const st of W.stories) outletCount[st.story_id] = (st.outlets || []).length;
const kept = [], dropped = [];
parsed.segments.forEach((seg, i) => {
  const text = String(seg.text || '').trim();
  const reasons = [];
  if (!text) reasons.push('empty');
  const ids = (seg.claim_ids || []).filter(Boolean);
  const FACT_KINDS = ['hook', 'story', 'context', 'quick_hit', 'recap'];
  const factual = FACT_KINDS.includes(seg.kind) || (['closer', 'question'].includes(seg.kind) && ids.length > 0);
  const nums = extractNumbers(text, LG);
  if (ADVICE.test(norm(text))) reasons.push('investment_advice_language');
  if (META.test(text)) reasons.push('talks about sources or verification instead of the news');
  for (const w of NEVER) if (neverRe(w).test(text)) reasons.push(`word "${w}" is not in ${HOST}'s vocabulary: say it without it`);
  const maxN = (S.profile && S.profile.numbers_per_sentence) || 4;
  const NAMED = /\b(S&P ?500|Nasdaq(-| )100|FTSE ?100|DAX ?40|Stoxx ?600|Nikkei ?225|Russell ?2000|Hang Seng|CAC ?40|GTA ?\d+|G7|G20|Covid-19|Q[1-4]|[1-9]G)\b/gi; // index and product names are not figures
  const dense = text.split(/(?<=[.!?])\s+/).map(se => extractNumbers(se.replace(NAMED, ''), LG).nums.filter(n => !n.isYear).length).find(c => c > maxN);
  if (dense) reasons.push(`too many numbers in one sentence for this listener (${dense}, max ${maxN}): keep the one that matters, say the rest in words`);
  if (factual) {
    if (!ids.length) reasons.push('fact segment without claim_ids');
    const cs = ids.map(id => full[id]);
    if (cs.some(c => !c || c.status !== 'verified' || !claimById[c.claim_id])) reasons.push('cites a claim that is not verified / not in this briefing');
    else {
      const ev = cs.map(c => extractNumbers(c.internal.evidence_quote, 'en'));
      const evN = ev.flatMap(e => e.nums), evT = ev.flatMap(e => e.times);
      for (const n of nums.nums) if (!n.isYear && !numIn(n.v, evN)) reasons.push(`number not in sources: ${n.tok}`);
      for (const t of nums.times) if (!evT.includes(t)) reasons.push(`time not in sources: ${t}`);
      if (CAUSAL.test(norm(text)) && !cs.some(c => c.claim_type === 'attributed_view' || c.attribution)) reasons.push('states a cause no source attributes');
    }
    if (seg.kind === 'question' && nums.nums.length) reasons.push('a question must not contain numbers');
  } else if (nums.nums.length || nums.times.length) reasons.push(`number in a ${seg.kind} segment (only allowed with a cited claim)`);
  if (['for_you', 'background'].includes(seg.kind) && ids.length) reasons.push(`a ${seg.kind} segment must not cite facts`);
  const out = { index: i, kind: seg.kind, text, claim_ids: ids, story_id: seg.story_id || (ids[0] && claimById[ids[0]] ? claimById[ids[0]].story_id : null) };
  (reasons.length ? dropped : kept).push(reasons.length ? { ...out, reasons } : out);
});

const wordOnly = d => d.reasons.every(r => r.startsWith('word "'));
const repairable = dropped.filter(d => (d.claim_ids.length && d.claim_ids.every(id => full[id] && full[id].status === 'verified' && claimById[id])) || (!d.claim_ids.length && wordOnly(d)));
if (!VERIFY.USE_LLM_VERIFIER || !(kept.length + repairable.length)) return [{ json: { writer_ok: true, parts_report: partsReport, segments: kept, dropped, skip_verifier: true, usage: [...editorUsage] } }];

const SYSTEM = `You are the independent fact checker AND repair editor of an audio news script. For each segment, compare it with the CLAIMS it cites (statement, attribution, outlet and evidence).
A factual segment (hook, story, context, quick_hit, recap, question or closer with claims) is NOT supported if it: adds a fact, number, date, name, comparison, cause, consequence, prediction or judgement of significance that the cited claims do not contain; changes a number or drops/changes a qualifier (period, month-on-month vs year-on-year, estimate vs actual, "around", "more than"); presents an attributed view as fact; or gives investment advice.
Allowed: rephrasing, combining claims, naming the outlet that published a cited claim ("Invezz reports"), plain-language wording of the same fact.
Also allowed: comparing or relating numbers that are all in the cited claims ("well above the 125 billion expected"), and "several outlets report" when story_outlet_count is 2 or more. Not naming the outlet is fine.
Never allowed anywhere: talking about sources, verification or what is unknown ("we cannot verify", "the material does not establish") - mark it unsupported and repair it away.
Non-factual segments: "teaser" may only name topics that are covered; "for_you" may only relate facts already told to the listener's interests - no new facts, no predictions, no advice; "background" may only explain a general, timeless concept (what Bitcoin is, what revenue means) - no news, no numbers, no dates, nothing contested; "closer" without claims may only wrap up without new facts. Mark them unsupported if they break this.
Some segments arrive with "known_problem" from an automatic check: treat them as unsupported and fix exactly that problem (for "too many numbers": keep only the number that matters and say the rest in words, e.g. "almost doubled").
REPAIR: for every unsupported segment, write "fixed_text": the same segment rewritten so it says only what its cited claims support - keep the role, keep it natural for the ear, keep numbers exactly as in the claims, drop the unsupported part. If nothing useful remains, return "". For supported segments return "".
Repairs keep the voice of the host, ${HOST} (${CHAR.tone || ''}), and never use these words: ${NEVER.map(w => '"' + w + '"').join(', ') || 'none'}.
${LG === 'en' ? '' : `The script is in ${LG_NAME}, the claims are in English: a faithful translation is supported. Numbers written the ${LG_NAME} way ("3,5", "115,8 Milliarden"/"miljard") count as the same number. Write every fixed_text in ${LG_NAME}.\n`}Be strict about facts, relaxed about style.`;
const toCheck = [...kept.map(k => ({ ...k, known_problem: null })), ...repairable.map(d => ({ ...d, known_problem: d.reasons.join('; ') }))].sort((a, b) => a.index - b.index);
const user = JSON.stringify({
  segments: toCheck.map(k => ({ index: k.index, kind: k.kind, text: k.text, known_problem: k.known_problem, story_outlet_count: k.story_id ? (outletCount[k.story_id] || 1) : null, cited_claims: k.claim_ids.map(id => ({ claim_id: id, statement: full[id].statement, attribution: full[id].attribution, outlet: full[id].publication, evidence: full[id].internal.evidence_quote })) })),
}, null, 1);
const SCHEMA = { type: 'object', additionalProperties: false, required: ['verdicts'], properties: { verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['index', 'supported', 'problem', 'fixed_text'], properties: { index: { type: 'integer' }, supported: { type: 'boolean' }, problem: { type: 'string' }, fixed_text: { type: 'string' } } } } } };
const body = {
  model: VERIFY.OPENAI_MODEL,
  messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
  response_format: { type: 'json_schema', json_schema: { name: 'script_check', strict: true, schema: SCHEMA } },
  max_completion_tokens: toCheck.length > 25 ? 16000 : 8000,
};
if (/^(gpt-5|o\d)/.test(VERIFY.OPENAI_MODEL) && VERIFY.REASONING_EFFORT) body.reasoning_effort = VERIFY.REASONING_EFFORT;
return [{ json: { writer_ok: true, parts_report: partsReport, segments: kept, dropped, repairable: repairable.map(d => d.index), skip_verifier: false, usage: [...editorUsage], openai_body: body } }];
