// ============================================================================
// WORKFLOW B — NODE: "Build writer request"   (Code node, Run Once for All Items)
// The WRITER turns the plan (after the material check) into a spoken script, using
// only the verified claims of each story. ONE REQUEST PER STORY (quick hits share one),
// each with its own word target - models hit 150-400 words reliably, not 1,500 at once.
// The lead request also writes the hook + teaser, the last one the closer (+ recap in long briefings).
// Greeting and sign-off are added by code. Output: one item per request { part, openai_body, ... }.
// ============================================================================
const WRITER = {
  USE_LLM_WRITER: true,          // false = template script (reads claims one by one)
  OPENAI_MODEL: 'gpt-6.1-terra',
  REASONING_EFFORT: 'medium',
};
const M = $('Material check').first().json;
const S = $('Select stories').first().json;
const P = S.profile;
const stories = M.stories;
const plan = { mode: S.planner.mode, interpretation: S.planner.interpretation, changes: M.changes };
const base = { plan, stories, target_words: M.target_words };
if (!WRITER.USE_LLM_WRITER || !stories.length) return [{ json: { use_writer: false, reason: stories.length ? 'writer disabled' : 'no story with verified facts', ...base } }];

const CH = P.character;
const KNOW = {
  beginner: `The listener is new to this: explain each unfamiliar term in one plain sentence the first time it appears, in ${CH.name}'s voice. Explanations are wanted, also for ${CH.name}.`,
  intermediate: CH.explain_default ? 'Explain a term only if most people would not know it.' : 'Do not define common terms.',
  expert: 'The listener knows the field: no definitions.',
}[P.expertise] || '';
const wordsTotal = stories.reduce((a, s) => a + s.words, 0);
const NAME = P.listener_name || null;
const HOOKS = (S.planner.listener_hooks || []).join('; ');
const BACKGROUND = (S.planner.background_needed || []).join('; ');
const KINDS = CH.segments;
const LANG = P.language || 'en';
const LANG_NAME = { en: 'English', de: 'German', nl: 'Dutch' }[LANG];
const LANGUAGE = LANG === 'en' ? '' : `LANGUAGE: write EVERY segment in ${LANG_NAME}, natural spoken ${LANG_NAME} as a native ${CH.name} would say it on ${LANG === 'de' ? 'German' : 'Dutch'} radio. The claims are in English: translate them faithfully, never adding or dropping meaning. ${LANG === 'de' ? 'Address the listener with "du".' : 'Address the listener with "je".'}
Numbers keep exactly the same values, written the ${LANG_NAME} way: decimal comma and the ${LANG_NAME} scale word (${LANG === 'de' ? '"3,5 Prozent", "115,8 Milliarden Dollar", "180.000"; never "Billion" for billion' : '"3,5 procent", "115,8 miljard dollar", "180.000"'}). Keep names of companies, people, indices and products as they are. Explanations of terms in ${LANG_NAME} too.`;
const SYSTEM = `You are ${CH.name}, the host of "${CH.show}", a personal morning news briefing. You talk to ONE listener${NAME ? ', ' + NAME : ''}: ${CH.listener}. You sound like ${CH.sounds_like}. Tone: ${CH.tone}.
Stay in character in EVERY sentence: a listener must be able to tell ${CH.name} from the other hosts after one sentence.

${CH.name.toUpperCase()}'S RULES
${CH.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
Sentence pattern for each story: ${CH.pattern}.
Story order inside your part: ${CH.order}.
Numbers: ${CH.numbers}
When a fact leaves something open (no date, no timing, no duration), say it in ${CH.name}'s words: "${CH.uncertainty}" - never guess.
Words ${CH.name} uses naturally: ${CH.uses.map(w => '"' + w + '"').join(', ')}.
NEVER say: ${CH.never.map(w => '"' + w + '"').join(', ')}.
Avoid: ${CH.avoid}.
Signature move: ${CH.signature}
${KNOW}
${LANGUAGE}

THE SHARED RULE: you may simplify or leave out, but never add. No cause, forecast, amount or judgement that is not in the claims. Simplify wording only with the number kept ("a little, to 3.5 percent").

HOW IT SHOULD SOUND
- Connected, not a list of facts: each story follows the sentence pattern, and facts are linked to each other ("that is well above the 125 billion analysts expected"). Comparing two given numbers is allowed.
${KINDS.includes('for_you') ? `- One short "for_you" segment per main story links the facts already told to what this listener cares about (${HOOKS || 'their day'}), in ${CH.name}'s way. No new facts, no numbers, no predictions, never advice.` : `- ${CH.name} adds no personal commentary: no "for_you" segments.`}
- Move from story to story through content or with ${CH.name}'s own short transitions; never "Moving on" or "Now to stocks".
- Do NOT name outlets or say "X reports". The transcript links every source. Exceptions: opinions, forecasts and odds keep who said them ("analysts at Citi expect"). 
- Do NOT talk about sources, verification or evidence ("we cannot verify", "the material does not establish").
- Write for the ear: no lists, brackets, URLs, tickers or abbreviations a listener cannot hear.

FACT RULES - a sentence that breaks one is removed before it is spoken:
1. Every fact, number, name, date, cause and consequence comes from the CLAIMS of that story. Nothing from memory.
   If a story's reported_on date is more than a week before 2026-11-19, it is older background: say when it was reported ("back in September, ...") and never present it as today's news.
2. Every segment that states a fact lists the claim_ids it uses. Numbers exactly as in the claim ("percent" is fine), qualifiers kept ("more than", "around", the period, estimate vs actual).
3. Only state a cause if a claim attributes it. Views, forecasts and odds keep their attribution.
4. No investment advice, no greeting and no sign-off (both are added separately).
5. Use EVERY claim you are given at least once (skip only exact repeats). Reach the word target by telling more of the story in ${CH.name}'s pattern - never by inventing facts.

SEGMENT KINDS YOU MAY USE: ${KINDS.map(k => '"' + k + '"').join(', ')}.
"hook", "teaser", "story", "context" (fact segments, 1-3 sentences, with claim_ids) · "recap" (long briefings only: the 2-3 things to take away, built from facts already told, with their claim_ids) · "quick_hit" (one or two sentences)${KINDS.includes('for_you') ? ' · "for_you" (relevance, no facts, no numbers, no claim_ids)' : ''}${KINDS.includes('background') ? ` · "background" (${BACKGROUND ? 'explain: ' + BACKGROUND + ' - ' : ''}a general, timeless explanation in 1-2 plain sentences: no news, no numbers, no dates, no claim_ids; only if the listener is a beginner, asked for it, or it is listed here)` : ''} · "closer" (what happens next, from an upcoming_event claim with its claim_id, or the uncertainty line).
${S.planner.interpretation ? 'WHAT THEY WANT TODAY: ' + S.planner.interpretation : ''}
`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['segments'],
  properties: { segments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'text', 'claim_ids', 'story_id'],
    properties: { kind: { type: 'string', enum: KINDS }, text: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } }, story_id: { type: ['string', 'null'] } } } } },
};
let LASTSEEN = {}; try { LASTSEEN = Object.fromEntries($('Get stories').all().map(i => [i.json.story_id, String(i.json.last_seen || '').slice(0, 10)])); } catch (e) {}
const strip = st => ({ story_id: st.story_id, reported_on: LASTSEEN[st.story_id] || null, role: st.role, angle: st.angle, outlet_count: (st.outlets || []).length, claims: st.claims.map(c => ({ claim_id: c.claim_id, statement: c.statement, type: c.type, attribution: c.attribution, figure: c.figure })) });
// parts: every full story alone, all quick hits together (in plan order)
const full = stories.filter(st => st.role !== 'quick_hit');
const quick = stories.filter(st => st.role === 'quick_hit');
const parts = full.map(st => ({ stories: [st], words: st.words }));
if (quick.length) parts.push({ stories: quick, words: quick.reduce((a, q) => a + q.words, 0), quick: true });
const long = P.duration_seconds >= 300;
const items = parts.map((part, i) => {
  const first = i === 0, last = i === parts.length - 1;
  const others = parts.filter((_, k) => k !== i).flatMap(pp => pp.stories.map(st => st.angle));
  const duty = [
    first ? `This is the LEAD part. Start with a "hook" segment, then ${parts.length > 1 ? `one "teaser" sentence naming what else is coming (${others.slice(0, 4).join(' | ')}) - topics only, no facts, no numbers, then ` : ''}the story. ${CH.id === 'tide' ? 'The teaser may name the order (policy, reaction, data).' : ''}` : `This is part ${i + 1} of ${parts.length}. Start with this story's own most interesting fact - no announcement like "Now to..."; the previous part was about: ${parts[i - 1].stories.map(st => st.angle).join(' | ')}.`,
    first ? ((BACKGROUND || P.format === 'explainer') && KINDS.includes('background') ? `You are the only part allowed to write "background" segments: explain once, briefly, the concepts this listener needs for the WHOLE briefing${BACKGROUND ? ' (' + BACKGROUND + ')' : ''}, where they first matter.` : '') : (KINDS.includes('background') ? 'Do NOT write "background" segments - the lead part already explained the basics.' : ''),
    KINDS.includes('for_you') ? 'At most ONE "for_you" segment in your part.' : '',
    part.quick ? 'These are QUICK HITS: one "quick_hit" segment per story, one or two sentences each, in the given order. Link them naturally, without announcing.' : `Tell this ${part.stories[0].role === 'background' ? 'BACKGROUND story (how we got here - from earlier this week)' : 'story'} in ${CH.name}'s sentence pattern (${CH.pattern}) with "story"/"context"${KINDS.includes('for_you') ? '/"for_you"' : ''} segments.`,
    last ? (long ? 'This is the LAST part: after the story, add a "recap" segment (the 2-3 things to take away, citing claim_ids of facts from ANY part listed under recap_facts) and then a "closer" that looks ahead and does not repeat a number already said.' : 'This is the LAST part: end with a "closer" that looks ahead or ties the stories together - do not repeat a number already said.') : 'Do not write a closer.',
  ].join(' ');
  const lo = Math.round(part.words * 0.9), hi = Math.round(part.words * 1.1);
  const recapFacts = last && long ? stories.flatMap(st => st.claims.slice(0, 4).map(c => ({ claim_id: c.claim_id, statement: c.statement }))) : undefined;
  const body = {
    model: WRITER.OPENAI_MODEL,
    messages: [{ role: 'system', content: SYSTEM + `\nYOUR PART: ${duty}\nWORD TARGET FOR YOUR PART: between ${lo} and ${hi} words. Count them. Shorter is a failure unless you have used every claim.` },
      { role: 'user', content: JSON.stringify({ request_today: P.listener_question || null, stories: part.stories.map(strip), recap_facts: recapFacts }, null, 1) }],
    response_format: { type: 'json_schema', json_schema: { name: 'briefing_part', strict: true, schema: SCHEMA } },
    max_completion_tokens: 12000,
  };
  if (WRITER.REASONING_EFFORT) body.reasoning_effort = WRITER.REASONING_EFFORT;
  return { json: { use_writer: true, part: i, parts: parts.length, part_story_ids: part.stories.map(st => st.story_id), part_words: part.words, ...base, openai_body: body } };
});
return items;
