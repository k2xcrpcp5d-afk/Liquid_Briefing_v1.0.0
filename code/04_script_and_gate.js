// ============================================================================
// NODE: "Build script & gate"   (Code node, Run Once for All Items)
// Builds spoken segments ONLY from verified claims, then runs the final gate.
// FAIL-CLOSED: if anything fails, this node throws -> ElevenLabs never runs.
// ============================================================================
const prep = $('Prepare article & request').first().json;
const CONFIG = prep.config;
const article = prep.article;
const v = $input.first().json;

// ---------------------------------------------------------------------------
// helpers (keep in sync with "Validate claims")
// ---------------------------------------------------------------------------
// <<GATE_HELPERS (shared with Workflow B "Build script & gate")
const norm = s => String(s || '').normalize('NFKC')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, '-')
  .replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
function extractNumbers(text, lang) {
  const t = norm(text);
  const times = [];
  const rest = t.replace(/\b(\d{1,2}):(\d{2})\b/g, m => { times.push(m); return ' '; });
  const decimalComma = ['de', 'nl', 'fr', 'es', 'it'].includes(lang);
  const SCALE = { trillion: 1e12, tn: 1e12, billionen: 1e12, billion: lang === 'de' ? 1e12 : 1e9, biljoen: 1e12, bn: 1e9, milliarden: 1e9, milliarde: 1e9, mrd: 1e9, miljard: 1e9, million: 1e6, millionen: 1e6, mio: 1e6, miljoen: 1e6, mln: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, tausend: 1e3, duizend: 1e3, k: 1e3 };
  const nums = [];
  const re = /-?\d+(?:[.,]\d+)*/g; let m;
  while ((m = re.exec(rest)) !== null) {
    const tok = m[0];
    const raw = decimalComma ? Number(tok.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : Number(tok.replace(/,(?=\d{3}\b)/g, ''));
    if (!Number.isFinite(raw)) continue;
    // "59 million", "$10.5bn", "65k" -> scaled value; the raw number is kept too
    const sc = rest.slice(m.index + tok.length).match(/^\s?(trillion|tn|billionen|billion|biljoen|bn|milliarden|milliarde|mrd|miljard|millionen|million|mio|miljoen|mln|mn|m|thousand|tausend|duizend|k)\b/);
    const v = sc ? raw * SCALE[sc[1]] : raw;
    nums.push({ tok: sc ? tok + ' ' + sc[1] : tok, v, raw, isYear: !sc && Number.isInteger(raw) && raw >= 1900 && raw <= 2100 && !/[.,]/.test(tok) });
  }
  return { nums, times };
}
const close = (a, b) => Math.abs(Math.abs(a) - Math.abs(b)) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const numIn = (x, list) => list.some(n => close(n.v, x) || close(n.raw, x));
const ADVICE = /\b(you should|investors should|traders should|should (buy|sell|invest|consider)|consider (buying|selling|adding)|(buy|sell) (now|the dip|signal)|good time to (buy|sell|invest)|worth buying|we recommend|recommend(s|ed)? (buying|selling)|strong (buy|sell)|go (long|short)|take profits?|price target|zacks rank|kaufempfehlung|verkaufsempfehlung|kursziel|(solltest|sollten|solltet) (du |sie |ihr |anleger )?(jetzt )?(kaufen|verkaufen|investieren)|jetzt (kaufen|verkaufen)|koopadvies|verkoopadvies|koersdoel|(moet|moeten) (je |u |beleggers )?(nu )?(kopen|verkopen|beleggen)|nu (kopen|verkopen))\b/;
const CAUSAL = /\b(because|due to(?! (report|release|publish|announce|be|start|begin|meet|hold|speak|present|launch|open|close|expire|end|pay|vote|decide|take|come|arrive|go))|weil|wegen|aufgrund|infolge|dank|ausgelöst durch|getrieben von|omdat|vanwege|dankzij|doordat|als gevolg van|veroorzaakt door|driven by|caused by|thanks to|on the back of|triggered|sparked|fuell?ed by|led to|prompted|weighed on|boosted by|as a result|in response to|amid)\b/;

// Spoken form: only formatting changes, never new facts. Digits must survive unchanged.
function toSpoken(text, lang) {
  const PCT = { de: 'Prozent', nl: 'procent' }[lang] || 'percent';
  const BPS = { de: 'Basispunkte', nl: 'basispunten' }[lang] || 'basis points';
  return text
    .replace(/(\d)\s?%/g, '$1 ' + PCT)
    .replace(/\bm\/m\b/gi, 'month on month')
    .replace(/\by\/y\b/gi, 'year on year')
    .replace(/\bq\/q\b/gi, 'quarter on quarter')
    .replace(/(\d)\s?bps?\b/gi, '$1 ' + BPS)
    .replace(/\s+/g, ' ')
    .trim();
}
const words = s => (s.match(/\S+/g) || []).length;
// GATE_HELPERS>>

// ---------------------------------------------------------------------------
// 1. select claims under the time budget (milestone 2: model order = newsworthiness)
// ---------------------------------------------------------------------------
const WORDS_PER_SECOND = 2.5; // ~150 wpm; calibrate after listening to real MP3s
const profile = CONFIG.PROFILE;
const verified = v.claims.filter(c => c.status === 'verified');
const byId = Object.fromEntries(v.claims.map(c => [c.claim_id, c]));

const d = new Date(CONFIG.BRIEFING_DATE + 'T12:00:00Z');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateSpoken = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

const segments = [];
segments.push({ kind: 'intro', template_id: 'intro_v1', display_text: `This is your markets briefing for ${dateSpoken}. It is read by an AI-generated voice.`, claim_ids: [] });
segments.push({ kind: 'transition', template_id: 'story_open_v1', display_text: `Our top story comes from ${article.publication}.`, claim_ids: [] });
const OUTRO = { kind: 'outro', template_id: 'outro_v1', display_text: 'That is the briefing. Every figure you heard links to its source article in the transcript. This is news, not investment advice.', claim_ids: [] };

const budgetWords = Math.floor(profile.duration_seconds * WORDS_PER_SECOND);
let used = words(segments.map(s => s.display_text).join(' ')) + words(OUTRO.display_text);
const dropped_for_time = [];
for (const c of verified) {
  const w = words(c.statement);
  if (used + w > budgetWords) { dropped_for_time.push(c.claim_id); continue; }
  segments.push({ kind: 'claim', template_id: null, display_text: c.statement, claim_ids: [c.claim_id] });
  used += w;
}
segments.push(OUTRO);

// fault injection: advisory sentence slipped into a factual segment
if (CONFIG.TEST_MODE === 'advice_in_script') {
  const seg = segments.find(s => s.kind === 'claim');
  if (seg) seg.display_text += ' Investors should consider buying the krone now.';
}

segments.forEach((s, i) => { s.index = i; s.spoken_text = toSpoken(s.display_text); });

// ---------------------------------------------------------------------------
// 2. final gate
// ---------------------------------------------------------------------------
const issues = [];
if (v.extraction_error) issues.push({ where: 'extraction', reason: v.extraction_error });
if (!verified.length) issues.push({ where: 'claims', reason: 'no_verified_claims' });
if (CONFIG.BLOCK_ON_ANY_REJECTED_CLAIM) {
  for (const c of v.claims.filter(x => x.status === 'rejected')) issues.push({ where: `claim ${c.local_id} (${c.claim_id})`, reason: c.errors.join(', ') });
}

for (const s of segments) {
  const where = `segment ${s.index} (${s.kind})`;
  const dN = norm(s.display_text);
  if (ADVICE.test(dN) || ADVICE.test(norm(s.spoken_text))) issues.push({ where, reason: 'investment_advice_language' });

  // spoken normalization must not change any digit
  const a = extractNumbers(s.display_text, 'en'), b = extractNumbers(s.spoken_text, 'en');
  if (a.nums.map(n => n.v).join('|') !== b.nums.map(n => n.v).join('|') || a.times.join('|') !== b.times.join('|')) {
    issues.push({ where, reason: 'spoken_normalization_changed_numbers' });
  }

  if (s.kind === 'claim') {
    if (!s.claim_ids.length) { issues.push({ where, reason: 'factual_segment_without_claim_id' }); continue; }
    const cs = s.claim_ids.map(id => byId[id]);
    if (cs.some(c => !c || c.status !== 'verified')) issues.push({ where, reason: 'segment_cites_unverified_claim' });
    const evid = cs.filter(Boolean).map(c => extractNumbers(c.internal.evidence_quote, article.language));
    const evNums = evid.flatMap(e => e.nums), evTimes = evid.flatMap(e => e.times);
    for (const n of a.nums) if (!n.isYear && !numIn(n.v, evNums)) issues.push({ where, reason: `number_not_supported:${n.tok}` });
    for (const t of a.times) if (!evTimes.includes(t)) issues.push({ where, reason: `time_not_supported:${t}` });
    if (CAUSAL.test(dN) && !cs.some(c => c && c.claim_type === 'attributed_view')) issues.push({ where, reason: 'unattributed_causality' });
  } else {
    if (!s.template_id) issues.push({ where, reason: 'non_factual_segment_not_from_template' });
    if (s.kind !== 'intro' && extractNumbers(s.display_text, 'en').nums.length) issues.push({ where, reason: 'numbers_in_non_factual_segment' });
  }
}

const tts_text = segments.map(s => s.spoken_text).join('\n\n');
if (tts_text.length > CONFIG.MAX_TTS_CHARS) issues.push({ where: 'script', reason: `too_long:${tts_text.length}>${CONFIG.MAX_TTS_CHARS}` });
if (CONFIG.SYNTHESIZE_AUDIO && /REPLACE/.test(CONFIG.ELEVENLABS_VOICE_ID)) issues.push({ where: 'config', reason: 'ELEVENLABS_VOICE_ID not set' });

if (issues.length) {
  const report = {
    run_id: prep.run_id,
    test_mode: CONFIG.TEST_MODE,
    injected_faults: v.injected_faults,
    counts: v.counts,
    issues,
    usage_log: v.usage_log,
  };
  throw new Error(`TTS BLOCKED - ${issues.length} issue(s): ` + issues.map(i => `[${i.where}] ${i.reason}`).join(' | ') + `\nREPORT ${JSON.stringify(report)}`);
}

// ---------------------------------------------------------------------------
// 3. approved output
// ---------------------------------------------------------------------------
return [{
  json: {
    run_id: prep.run_id,
    gate: { status: 'passed', checked_segments: segments.length, dropped_for_time },
    profile,
    story: v.story,
    claims: v.claims,
    usage_log: v.usage_log,
    script: {
      segments,
      tts_text,
      chars: tts_text.length,
      words: words(tts_text),
      est_duration_seconds: Math.round(words(tts_text) / WORDS_PER_SECOND),
    },
    tts: {
      enabled: !!CONFIG.SYNTHESIZE_AUDIO,
      voice_id: CONFIG.ELEVENLABS_VOICE_ID,
      output_format: CONFIG.ELEVENLABS_OUTPUT_FORMAT,
      body: { text: tts_text, model_id: CONFIG.ELEVENLABS_MODEL_ID },
    },
  },
}];
