// ============================================================================
// WORKFLOW B v2 — NODE: "Build script & gate"   (Code node, Run Once for All Items)
// Last check before the voice: a segment that states facts must cite verified claims,
// every number it says must be in those claims, host talk may not carry numbers, and
// nothing may sound like investment advice. Failing segments are dropped, not rewritten.
// Then: spoken text, recording parts (ElevenLabs limit) and timestamp marks.
// ============================================================================
const CFG = { SYNTHESIZE_AUDIO: false, TTS_MODEL_ID: 'eleven_v4_turbo', OUTPUT_FORMAT: 'mp3_44100_64', TTS_CHUNK_CHARS: 3800 };
/*__GATE_HELPERS__*/
const F = $('Finalize profile').first().json;
const P = F.profile;
const V = $('Verify facts').first().json;
const M = $input.first().json;
const LG = P.language || 'en';
const CH = P.character || { id: 'pip', name: 'Pip', pause_s: 0.3, delivery_tag: '' };
const W = V.words;
const claimById = Object.fromEntries(V.claims.map(c => [c.claim_id, c]));
const HOST_KINDS = ['greeting', 'hook', 'explainer', 'transition', 'reaction', 'closer', 'signoff'];
const count = s => (String(s || '').match(/\S+/g) || []).length;
const clean = s => String(s || '').replace(/https?:\/\/\S+/g, '').replace(/[*_#`>]+/g, '').replace(/\[(\d+|f\d+)\]/g, '').replace(/\s+/g, ' ').trim();

const claimNums = {};
for (const c of V.claims) {
  const txt = c.statement + ' ' + (c.quote || '') + ' ' + (c.date || '');
  claimNums[c.claim_id] = [...extractNumbers(txt, 'en').nums, ...extractNumbers(c.quote || '', 'de').nums];
}
const kept = [], dropped = [];
for (const s of M.draft.segments) {
  const text = clean(s.text);
  if (!text) continue;
  const ids = [...new Set((s.claim_ids || []).filter(id => claimById[id]))];
  const nums = extractNumbers(text, LG).nums;
  let why = null;
  if (ADVICE.test(text)) why = 'sounds like investment advice';
  else if (!ids.length && !HOST_KINDS.includes(s.kind)) why = 'states news without a verified source';
  else if (!ids.length && nums.some(n => !n.isYear)) why = 'number without a source';
  else if (ids.length) {
    const pool = ids.flatMap(id => claimNums[id]);
    const bad = nums.filter(n => !(n.isYear ? pool.some(x => close(x.raw, n.raw)) || ids.some(id => String(claimById[id].date || '').includes(String(n.raw))) : numIn(n.v, pool) || numIn(n.raw, pool)));
    if (bad.length) why = 'number not in its sources: ' + bad.map(n => n.tok).join(', ');
  }
  if (why) { dropped.push({ text: text.slice(0, 160), why }); continue; }
  kept.push({ kind: s.kind, story_id: s.story_key || null, display_text: text, claim_ids: ids });
}
const segments = kept.map((s, i) => ({ ...s, index: i, spoken_text: toSpoken(s.display_text, LG) }));
const totalWords = segments.reduce((a, s) => a + count(s.display_text), 0);
const est = Math.round(totalWords / P.words_per_second);
const SHORT = {
  en: (a, b) => `About ${a} of ${b} minutes: the trusted sources did not have more verified material on this.`,
  de: (a, b) => `Etwa ${a} von ${b} Minuten: Die vertrauenswürdigen Quellen hatten dazu nicht mehr geprüftes Material.`,
  nl: (a, b) => `Ongeveer ${a} van ${b} minuten: de betrouwbare bronnen hadden hierover niet meer gecontroleerd materiaal.`,
};
const mins = s => String(Math.max(1, Math.round(s / 60)));
const short_note = est < P.duration_seconds * 0.85 ? (SHORT[LG] || SHORT.en)(mins(est), mins(P.duration_seconds)) : null;
if (!segments.some(s => s.claim_ids.length)) throw new Error('No verified facts made it into the script. ' + (V.notes || []).join(' ') + `\nREPORT ${JSON.stringify({ dropped, check: V.check })}`);

// ---- recording in parts; marks map each segment to its part + character offset (for timestamps)
const voice = CH.voice;
const speed = Math.min(1.2, Math.max(0.7, voice.voice_settings.speed));
const chunks = [], marks = [];
let cur = '';
for (const sg of segments) {
  const body = CH.pause_s >= 0.5 ? sg.spoken_text.split(/(?<=[.!?])\s+/).join('\n\n') : CH.pause_s >= 0.4 ? sg.spoken_text.split(/(?<=[.!?])\s+/).join('\n') : sg.spoken_text;
  const said = (sg.index === 0 && CH.delivery_tag ? CH.delivery_tag : '') + body;
  if (cur && (cur + '\n\n' + said).length > CFG.TTS_CHUNK_CHARS) { chunks.push(cur); cur = ''; }
  const offset = cur ? cur.length + 2 + (said.length - body.length) : said.length - body.length;
  marks.push({ index: sg.index, chunk: chunks.length, offset, head: body.slice(0, 24) });
  cur = cur ? cur + '\n\n' + said : said;
}
if (cur) chunks.push(cur);
const used = new Set(segments.flatMap(s => s.claim_ids));
const result = {
  claims: V.claims.filter(c => used.has(c.claim_id)),
  script: { title: M.draft.title, segments, words: totalWords, chars: chunks.join('\n\n').length, est_duration_seconds: est },
  script_checks: { mode: 'v2_web', words_target: W, words_first_draft: M.words_first_draft, added_segments: M.added_segments, dropped, short_note, writer_error: M.writer_error },
  llm_usage: [...(V.usage || []), ...(M.llm_usage || [])],
  tts: { enabled: !!CFG.SYNTHESIZE_AUDIO, marks, voice_id: voice.voice_id, voice_name: voice.name, host: CH.name, output_format: CFG.OUTPUT_FORMAT,
    body: { text: '', model_id: CFG.TTS_MODEL_ID, voice_settings: { ...voice.voice_settings, speed: Number(speed.toFixed(2)) } } },
};
return chunks.map((text, i) => ({ json: i === 0
  ? { ...result, tts: { ...result.tts, part: 0, parts: chunks.length, body: { ...result.tts.body, text } } }
  : { tts: { ...result.tts, marks: undefined, part: i, parts: chunks.length, body: { ...result.tts.body, text } } } }));
