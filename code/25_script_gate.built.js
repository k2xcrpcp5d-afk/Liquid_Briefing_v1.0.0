// ============================================================================
// WORKFLOW B — NODE: "Build script & gate"   (Code node, Run Once for All Items)
// Writes the spoken script from VERIFIED claims only, shaped by the profile
// (story count, claims per story, explainers, tone), then runs the final gate.
// FAIL-CLOSED: throws "TTS BLOCKED" on any issue -> ElevenLabs never runs.
// ============================================================================
const CFG = {
  SYNTHESIZE_AUDIO: false,                 // true = call ElevenLabs (needs Header Auth credential xi-api-key)
  TTS_MODEL_ID: 'eleven_v4_turbo',         // newest generation (Sep 2026), USD 0.04 per 1K chars; 'eleven_v4' = more expressive, pricier
  OUTPUT_FORMAT: 'mp3_44100_64', // speech: 64 kbps is plenty and keeps 10-minute files small
  MAX_TTS_CHARS: 16000,                    // whole script (10 minutes is about 9,000 characters)
  TTS_CHUNK_CHARS: 3800,                   // per ElevenLabs request (v4 Turbo: 5,000 max) - parts are joined after recording
  MIN_LENGTH_SHARE: 0.85,                  // shorter than this -> the page explains why (no filler)
  WORDS_PER_SECOND: 2.5,
  CLAIMS_PER_STORY: { beginner: 2, intermediate: 3, expert: 4 },
  MAX_EXPLAINERS: 2,
};
// Premade ElevenLabs voices (should exist on every account - check). voice_settings.speed: 0.7-1.2.
const VOICE_PRESETS = {
  // three clearly different speakers (checked in the team's ElevenLabs account, premade voices)
  neutral_news: { voice_id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella - Professional, Bright, Warm', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: 1.0 } },
  calm_warm: { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George - Warm, Captivating Storyteller', voice_settings: { stability: 0.75, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.9 } },
  energetic: { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam - Energetic, Social Media Creator', voice_settings: { stability: 0.3, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true, speed: 1.1 } },
};
// Eleven v4 delivery tag for the energetic voice (spoken as delivery, not read out); calm/clear use voice + speed only
const DELIVERY_TAG = { energetic: '[excited] ' };

const S = $('Select stories').first().json;
const P = S.profile;
const CH = P.character || { id: 'pip', name: 'Pip', never: [], pause_s: 0.3, delivery_tag: '' };
const LG = P.language || 'en';
const WPS = P.words_per_second || CFG.WORDS_PER_SECOND;

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


// ---- claims: cached + newly extracted ------------------------------------------------
const newRows = $('Validate claims (batch)').all().map(i => i.json).filter(r => r.article_id);
const cacheRows = $('Get claim cache').all().map(i => i.json).filter(r => r.article_id && r.prompt_version === S.prompt_version);
const rowFor = id => newRows.find(r => r.article_id === id) || cacheRows.find(r => r.article_id === id);
const PRIORITY = { data_release: 1, company_result: 1, policy_decision: 1, forecast_or_estimate: 2, price_move: 3, attributed_view: 4, other_fact: 5 };

const storyPlans = [];
const dropped_stories = [];
let W = null; try { W = $('Build writer request').first().json; } catch (e) { W = null; }
const finalStories = W && W.stories ? W.stories.map(st => ({ ...(S.plan.selected.concat(S.plan.reserves || []).find(x => x.story_id === st.story_id) || {}), ...st })) : S.plan.selected;
for (const s of finalStories) {
  const row = rowFor(s.representative_article_id);
  const all = row ? JSON.parse(row.claims_json || '[]') : [];
  const verified = all.filter(c => c.status === 'verified');
  if (!verified.length) { dropped_stories.push({ story_id: s.story_id, title: s.title, why: row ? (row.extraction_error || `0 of ${all.length} claims passed the checks`) : 'no claims row' }); continue; }
  const ordered = verified.map((c, i) => ({ c, i })).sort((a, b) => (PRIORITY[a.c.claim_type] || 9) - (PRIORITY[b.c.claim_type] || 9) || a.i - b.i).map(x => x.c);
  const pick = [];
  let figures = 0;
  for (const c of ordered) {
    if (pick.length >= CFG.CLAIMS_PER_STORY[P.expertise]) break;
    if (P.expertise === 'beginner' && c.figure && figures >= 1) continue; // beginners: one number per story
    if (c.figure) figures++;
    pick.push(c);
  }
  storyPlans.push({ story: s, claims: pick, available_verified: verified.length, rejected: all.filter(c => c.status === 'rejected').map(c => ({ statement: c.statement, errors: c.errors })) });
}

// ---- segments ------------------------------------------------------------------------
const d = new Date(S.plan.briefing_date + 'T12:00:00Z');
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateSpoken = `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
const INTRO = {
  calm: `Good morning. Here is your briefing for ${dateSpoken}, read by an AI-generated voice.`,
  neutral: `Your briefing for ${dateSpoken}, read by an AI-generated voice.`,
  energetic: `Good morning! Your briefing for ${dateSpoken}, read by an AI-generated voice. Let's go.`,
}[P.tone];
const OUTRO = {
  calm: 'That is all for today. Every fact links to its source in the transcript. This is news, not investment advice.',
  neutral: 'That is the briefing. Every fact links to its source in the transcript. News, not investment advice.',
  energetic: 'That is your briefing! Every fact links to its source in the transcript. News, not investment advice.',
}[P.tone];
const ORD = ['First', 'Next', 'Then', 'Also today', 'Another story', 'One more', 'And finally'];
const GLOSSARY = [
  [/producer price|\bppi\b|wholesale inflation/i, 'producer prices', 'A quick explainer: producer prices are what companies charge for goods and services before they reach the shops.'],
  [/\bipo\b|initial public offering|goes public|stock market debut/i, 'IPO', 'A quick explainer: an IPO is when a company sells its shares on the stock market for the first time.'],
  [/class[- ]action|shareholder lawsuit|investors (sued|sue)/i, 'shareholder lawsuit', 'A quick explainer: in a shareholder lawsuit, investors take a company to court because they say they were misled.'],
  [/consumer price|\bcpi\b/i, 'consumer prices', 'A quick explainer: consumer prices measure what households pay for everyday goods and services.'],
  [/year[- ]on[- ]year|year[- ]over[- ]year|from a year earlier|annual/i, 'year-on-year', 'A quick explainer: year-on-year means a number is compared with the same period one year earlier.'],
  [/basis points?/i, 'basis point', 'A quick explainer: a basis point is one hundredth of a percentage point.'],
  [/\betfs?\b/i, 'ETF', 'A quick explainer: an ETF is a fund that trades on the stock market like a single share.'],
  [/interest rates?|rate (hike|cut)s?/i, 'interest rate', 'A quick explainer: the interest rate set by a central bank is the price of borrowing money in that economy.'],
];

// ---- writer path: LLM script, already checked deterministically + by the verifier ----------
const FACT_KINDS = ['claim', 'hook', 'story', 'context', 'quick_hit', 'recap'];
const isFactual = sg => FACT_KINDS.includes(sg.kind) || (['closer', 'question'].includes(sg.kind) && (sg.claim_ids || []).length > 0);
let VR = null; try { VR = $('Check script & build verifier request').first().json; } catch (e) { VR = null; }
const vin = $input.first().json;
const script_checks = { mode: 'template', dropped: [], verifier: 'not used' };
const llmUsage = [];
let segments;
const trimmed = [];
const allClaims = {};
for (const r of [...cacheRows, ...newRows]) for (const c of JSON.parse(r.claims_json || '[]')) allClaims[c.claim_id] = c;
// deterministic re-check for a repaired sentence: numbers must be in the cited evidence, no advice, no unattributed cause
const META = /\b(we (cannot|can't|can not) (verify|confirm)|(können|konnten) (wir )?(das )?nicht (überprüfen|bestätigen|verifizieren)|nicht verifiziert|kunnen (we )?(dit )?niet (verifiëren|bevestigen|controleren)|niet geverifieerd|primary sources?|the material (available|here|provided)|(does|do) not establish|is not established|from the (material|sources) available|not (yet )?verified|cannot be verified)\b/i;
// a repaired sentence may keep the right number but change what it means (the Flo "2.1%" case):
// for every number that is a cited claim's figure, the sentence must not flip its comparison basis, direction or estimate/actual
const MEAN = {
  month: /\b(month[- ](on|over)[- ]month|m\/m|monthly|from (the )?(previous|prior|last) month|im vormonat|gegenüber dem vormonat|zum vormonat|monatlich|maand[- ]op[- ]maand|ten opzichte van (de )?vorige maand|maandelijks)\b/,
  year: /\b(year[- ](on|over)[- ]year|y\/y|annual(ly|ised|ized)?|from a year (earlier|ago|before)|than a year (earlier|ago)|im jahresvergleich|gegenüber dem vorjahr|zum vorjahr|jährlich|jaar[- ]op[- ]jaar|op jaarbasis|ten opzichte van (een jaar|vorig jaar)|jaarlijks)\b/,
  quarter: /\b(quarter[- ](on|over)[- ]quarter|q\/q|from the (previous|prior|last) quarter|gegenüber dem vorquartal|kwartaal[- ]op[- ]kwartaal)\b/,
  up: /\b(rose|rise[sn]?|rising|up|increase[sd]?|increasing|gain(ed|s)?|climb(ed|s)?|jump(ed|s)?|surge[sd]?|higher|grew|grow(s|ing)?|stieg(en)?|gestiegen|steigt|legte zu|zugelegt|höher|wuchs|gewachsen|steeg|stegen|gestegen|stijgt|hoger|groeide|gegroeid)\b/,
  down: /\b(fell|fall(s|en|ing)?|drop(ped|s)?|down|decrease[sd]?|declin(ed|es|ing)|lower|slump(ed|s)?|plunge[sd]?|shrank|sank|slid|fiel(en)?|gefallen|sinkt|sank|niedriger|gesunken|verlor|daalde(n)?|gedaald|daalt|lager|zakte|gezakt)\b/,
  est: /\b(expect(ed|s|ations?)?|forecast(s|ed)?|estimat(e|ed|es)|consensus|projected|predict(ed|s)?|anticipated|could|would|may|might|target|erwart(et|ung|ungen)?|prognos(e|tiziert)|geschätzt|schätzung|konsens|könnte|verwacht(ing|ingen)?|voorspel(d|ling)|geschat|schatting|consensus|zou|kan)\b/,
};
function meaningIssue(text, cs) {
  const figs = cs.filter(c => c && c.figure && Number.isFinite(Number(c.figure.value)));
  if (!figs.length) return null;
  for (const se of text.split(/(?<=[.!?])\s+/)) {
    const low = norm(se);
    for (const n of extractNumbers(se, LG).nums) {
      if (n.isYear) continue;
      const own = figs.filter(c => close(Number(c.figure.value), n.v) || close(Number(c.figure.value), n.raw));
      if (!own.length) continue;
      const okBasis = own.some(c => { const b = c.figure.comparison_basis; const has = k => MEAN[k].test(low);
        if (b === 'month_over_month') return !(has('year') || has('quarter')) || has('month');
        if (b === 'year_over_year') return !(has('month') || has('quarter')) || has('year');
        if (b === 'quarter_over_quarter') return !(has('month') || has('year')) || has('quarter');
        return true; });
      if (!okBasis) return `meaning changed: comparison basis of ${n.tok}`;
      const okDir = own.some(c => { const d = c.figure.direction;
        if (d === 'up' || d === 'increase') return !MEAN.down.test(low) || MEAN.up.test(low);
        if (d === 'down' || d === 'decrease') return !MEAN.up.test(low) || MEAN.down.test(low);
        return true; });
      if (!okDir) return `meaning changed: direction of ${n.tok}`;
      const okEst = own.some(c => !/^(estimate|expected|forecast|projection|target)/.test(String(c.figure.measure || 'actual')) || MEAN.est.test(low));
      if (!okEst) return `meaning changed: ${n.tok} is an estimate, said as a fact`;
    }
  }
  return null;
}
function repairIssue(text, sg) {
  const t = norm(text);
  if (ADVICE.test(t)) return 'advice language';
  if (META.test(text)) return 'talks about sources';
  const cs = (sg.claim_ids || []).map(id => allClaims[id]);
  const nums = extractNumbers(text, LG);
  if (!cs.length || cs.some(c => !c || c.status !== 'verified')) return nums.nums.length ? 'numbers without a verified claim' : null;
  const ev = cs.map(c => extractNumbers(c.internal.evidence_quote, 'en'));
  const evN = ev.flatMap(e => e.nums);
  for (const n of nums.nums) if (!n.isYear && !numIn(n.v, evN)) return 'number not in sources: ' + n.tok;
  const meaning = meaningIssue(text, cs);
  if (meaning) return meaning;
  if (CAUSAL.test(t) && !cs.some(c => c.claim_type === 'attributed_view' || c.attribution)) return 'unattributed cause';
  if (sg.kind === 'question' && nums.nums.length) return 'number in a question';
  const nw = (CH.never || []).find(w => new RegExp('(^|[^a-z])' + w.replace(/[^a-z ]/gi, '') + '($|[^a-z])', 'i').test(text));
  if (nw) return `word "${nw}" is not in ${CH.name}'s vocabulary`;
  const maxN = P.numbers_per_sentence || 4;
  const NAMED = /\b(S&P ?500|Nasdaq(-| )100|FTSE ?100|DAX ?40|Stoxx ?600|Nikkei ?225|Russell ?2000|Hang Seng|CAC ?40|GTA ?\d+|G7|G20|Covid-19|Q[1-4]|[1-9]G)\b/gi;
  if (text.split(/(?<=[.!?])\s+/).some(se => extractNumbers(se.replace(NAMED, ''), LG).nums.filter(n => !n.isYear).length > maxN)) return 'still too many numbers in one sentence';
  return null;
}
if (VR && VR.writer_ok && (VR.segments.length || (VR.repairable || []).length)) {
  script_checks.mode = 'llm_writer';
  script_checks.parts = VR.parts_report || [];
  script_checks.dropped = [...VR.dropped.map(d => ({ text: d.text, why: d.reasons.join('; '), by: 'number/advice/source check' }))];
  llmUsage.push(...(VR.usage || []));
  let keep = VR.segments;
  if (!VR.skip_verifier) {
    try {
      const verdicts = JSON.parse(vin.choices[0].message.content).verdicts;
      const vmap = new Map(verdicts.map(v => [v.index, v]));
      const repairable = new Set(VR.repairable || []);
      const pool = [...VR.segments, ...VR.dropped.filter(d => repairable.has(d.index))].sort((a, b) => a.index - b.index);
      script_checks.dropped = VR.dropped.filter(d => !repairable.has(d.index)).map(d => ({ text: d.text, why: d.reasons.join('; '), by: 'number/advice/source check' }));
      script_checks.repaired = [];
      let removed = 0;
      keep = [];
      for (const sg of pool) {
        const v = vmap.get(sg.index);
        const known = sg.reasons ? sg.reasons.join('; ') : null;
        if (v && v.supported && !known) { keep.push(sg); continue; }
        const why = [known, v && v.problem].filter(Boolean).join(' / ') || 'not checked';
        const fix = v && String(v.fixed_text || '').trim();
        const fixIssue = fix ? repairIssue(fix, sg) : 'no repair offered';
        if (!fixIssue) { keep.push({ ...sg, text: fix, reasons: undefined }); script_checks.repaired.push({ before: sg.text, after: fix, why }); }
        else { removed++; script_checks.dropped.push({ text: sg.text, why: why + (fix ? ` (repair rejected: ${fixIssue})` : ''), by: known ? 'number/advice/source check' : 'LLM fact check' }); }
      }
      script_checks.verifier = `checked ${verdicts.length} segments, repaired ${script_checks.repaired.length}, removed ${removed}`;
      const u = vin.usage || {};
      llmUsage.push({ stage: 'script_verifier', model: vin.model, input_tokens: u.prompt_tokens || 0, cached_input_tokens: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0, output_tokens: u.completion_tokens || 0 });
    } catch (e) { script_checks.verifier = 'verifier unavailable - kept segments that passed the deterministic checks'; }
  }
  // no intro/outro templates and no spoken disclaimers (decided by the team); disclosure stays on the page
  segments = keep.map(sg => ({ kind: sg.kind, template_id: isFactual(sg) ? null : 'llm_' + sg.kind, story_id: sg.story_id, display_text: sg.text, claim_ids: sg.claim_ids }));
} else {
  if (VR && !VR.writer_ok) script_checks.writer_error = VR.writer_error;
  segments = [];
  let explainers = 0;
  const explained = new Set();
  storyPlans.forEach((sp, i) => {
    const ord = i === storyPlans.length - 1 && storyPlans.length > 1 ? 'And finally' : ORD[Math.min(i, ORD.length - 2)];
    const outlets = sp.story.outlets.length > 1 ? `${sp.story.outlets.slice(0, -1).join(', ')} and ${sp.story.outlets.slice(-1)}` : sp.story.outlets[0];
    segments.push({ kind: 'transition', template_id: 'story_open', story_id: sp.story.story_id, display_text: `${ord}, a story reported by ${outlets}.`, claim_ids: [] });
    for (const c of sp.claims) segments.push({ kind: 'claim', template_id: null, story_id: sp.story.story_id, display_text: c.statement, claim_ids: [c.claim_id] });
    if (P.explain_terms && explainers < CFG.MAX_EXPLAINERS) {
      const txt = sp.claims.map(c => c.statement).join(' ');
      const g = GLOSSARY.find(([re, term]) => re.test(txt) && !explained.has(term));
      if (g) { segments.push({ kind: 'explainer', template_id: 'glossary_' + g[1], story_id: sp.story.story_id, display_text: g[2], claim_ids: [] }); explained.add(g[1]); explainers++; }
    }
  });

  // ---- fit the time budget: drop trailing claims (keep >= 1 per story) ------------------------
  const budget = Math.floor(P.duration_seconds * CFG.WORDS_PER_SECOND);
  const totalWords = () => segments.reduce((n, s) => n + words(s.display_text), 0);
  while (totalWords() > budget * 1.1) {
    let idx = -1;
    for (let k = segments.length - 1; k >= 0; k--) {
      const s = segments[k];
      if (s.kind !== 'claim') continue;
      if (segments.filter(x => x.kind === 'claim' && x.story_id === s.story_id).length > 1) { idx = k; break; }
    }
    if (idx < 0) break;
    trimmed.push(segments[idx].claim_ids[0]);
    segments.splice(idx, 1);
  }
}
// ---- length: no filler. If the script is shorter than asked, the page says so (honest, not padded) ----
const target = Math.round(P.duration_seconds * WPS);
const spokenWords = segments.reduce((n, sg) => n + words(sg.display_text), 0) + 15;
const gotS = Math.round(spokenWords / WPS);
const SHORT = {
  en: `about ${gotS} of ${P.duration_seconds} seconds`, de: `etwa ${gotS} von ${P.duration_seconds} Sekunden`, nl: `ongeveer ${gotS} van ${P.duration_seconds} seconden`,
};
const THIN = { en: 'there were not enough verified facts on these stories to fill more without padding', de: 'zu diesen Storys gab es nicht genug geprüfte Fakten, um mehr zu füllen, ohne zu strecken', nl: 'er waren niet genoeg gecontroleerde feiten over deze verhalen om meer te vullen zonder op te vullen' };
if (spokenWords < target * CFG.MIN_LENGTH_SHARE) script_checks.short_note = S.planner && S.planner.short_reason
  ? `${SHORT[LG]}. ${S.planner.short_reason}`
  : `${SHORT[LG]}: ${THIN[LG]}`;
// ---- opener and sign-off: written by code per host, never by a model, no facts ----------------------
const NUMW = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
  de: ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'],
  nl: ['nul', 'één', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien', 'elf', 'twaalf'],
}[LG];
const NAME = P.listener_name || null;
const nStories = new Set(segments.filter(sg => isFactual(sg) && sg.story_id).map(sg => sg.story_id)).size;
const nW = NUMW[nStories] || { en: 'a few', de: 'ein paar', nl: 'een paar' }[LG];
const capW = w => w.charAt(0).toUpperCase() + w.slice(1);
const one = nStories === 1;
const nm = NAME ? ', ' + NAME : '';
const T = {
  en: { hi: `Morning${nm}`, open: {
      pip: `Morning${nm}! ${capW(nW)} ${one ? 'thing' : 'things'} before you head out.`,
      tide: `Morning${nm}. What moved, and whether it was expected.`,
      flo: `Morning${nm}. ${capW(nW)} ${one ? 'item' : 'items'} on the board.`,
      brook: `Morning${nm}. Costs first, then customers, then what to watch.`,
      rain: `Morning${nm}. ${capW(nW)} ${one ? 'thing' : 'things'} for home today.` },
    close: { pip: `That's it. Have a good one${nm}.`, tide: "That's the briefing. None of this is investment advice.", flo: "That's the board.", brook: `That's the lot. Good luck with the day${nm}.`, rain: `That's everything. Have a calm morning${nm}.` } },
  de: { hi: `Morgen${nm}`, open: {
      pip: `Morgen${nm}! ${one ? 'Eine Sache' : capW(nW) + ' Dinge'}, bevor du losgehst.`,
      tide: `Morgen${nm}. Was sich bewegt hat, und ob es erwartet war.`,
      flo: `Morgen${nm}. ${one ? 'Ein Punkt' : capW(nW) + ' Punkte'} auf der Tafel.`,
      brook: `Morgen${nm}. Erst die Kosten, dann die Kunden, dann der Ausblick.`,
      rain: `Morgen${nm}. ${one ? 'Eine Sache' : capW(nW) + ' Dinge'} für zu Hause.` },
    close: { pip: `Das war's. Mach's gut${nm}.`, tide: 'Das war das Briefing. Nichts davon ist eine Anlageberatung.', flo: 'Das war die Tafel.', brook: `Das war's. Einen guten Tag${nm}.`, rain: `Das war alles. Einen entspannten Morgen${nm}.` } },
  nl: { hi: `Goedemorgen${nm}`, open: {
      pip: `Goedemorgen${nm}! ${one ? 'Eén ding' : capW(nW) + ' dingen'} voordat je de deur uit gaat.`,
      tide: `Goedemorgen${nm}. Wat er bewoog, en of het verwacht was.`,
      flo: `Goedemorgen${nm}. ${one ? 'Eén punt' : capW(nW) + ' punten'} op het bord.`,
      brook: `Goedemorgen${nm}. Eerst de kosten, dan de klanten, dan wat eraan komt.`,
      rain: `Goedemorgen${nm}. ${one ? 'Eén ding' : capW(nW) + ' dingen'} voor thuis vandaag.` },
    close: { pip: `Dat was het. Fijne dag${nm}.`, tide: 'Dat was de briefing. Niets hiervan is beleggingsadvies.', flo: 'Dat was het bord.', brook: `Dat was het. Succes vandaag${nm}.`, rain: `Dat was alles. Een rustige ochtend${nm}.` } },
}[LG];
const OPEN = T.open, CLOSE = T.close, hi = T.hi;
segments.unshift({ kind: 'greeting', template_id: 'greeting', story_id: null, display_text: OPEN[CH.id] || `${hi}.`, claim_ids: [] });
segments.push({ kind: 'signoff', template_id: 'signoff', story_id: null, display_text: CLOSE[CH.id] || "That's it for today.", claim_ids: [] });
segments.forEach((s, i) => { s.index = i; s.spoken_text = toSpoken(s.display_text, LG); });

// ---- final gate ---------------------------------------------------------------------------
const claimById = {};
for (const sg of segments) for (const id of sg.claim_ids) if (allClaims[id]) claimById[id] = allClaims[id];
const issues = [];
if (!segments.some(sg => isFactual(sg))) issues.push({ where: 'plan', reason: 'no story has verified claims' + (dropped_stories.length ? ' (' + dropped_stories.map(x => x.why).join('; ') + ')' : '') });
for (const s of segments) {
  const where = `segment ${s.index} (${s.kind})`;
  const dN = norm(s.display_text);
  if (ADVICE.test(dN) || ADVICE.test(norm(s.spoken_text))) issues.push({ where, reason: 'investment_advice_language' });
  if (META.test(s.display_text)) issues.push({ where, reason: 'meta_commentary_about_sources' });
  const a = extractNumbers(s.display_text, LG), b = extractNumbers(s.spoken_text, LG);
  if (a.nums.map(n => n.v).join('|') !== b.nums.map(n => n.v).join('|') || a.times.join('|') !== b.times.join('|')) issues.push({ where, reason: 'spoken_normalization_changed_numbers' });
  if (isFactual(s)) {
    const cs = s.claim_ids.map(id => claimById[id]);
    if (!cs.length || cs.some(c => !c || c.status !== 'verified')) { issues.push({ where, reason: 'segment_cites_unverified_claim' }); continue; }
    const ev = cs.map(c => extractNumbers(c.internal.evidence_quote, 'en'));
    const evN = ev.flatMap(e => e.nums), evT = ev.flatMap(e => e.times);
    for (const n of a.nums) if (!n.isYear && !numIn(n.v, evN)) issues.push({ where, reason: `number_not_supported:${n.tok}` });
    for (const t of a.times) if (!evT.includes(t)) issues.push({ where, reason: `time_not_supported:${t}` });
    if (CAUSAL.test(dN) && !cs.some(c => c.claim_type === 'attributed_view' || c.attribution)) issues.push({ where, reason: 'unattributed_causality' });
  } else {
    if (!s.template_id) issues.push({ where, reason: 'non_factual_segment_not_from_template' });
    if (s.kind !== 'intro' && a.nums.length) issues.push({ where, reason: 'numbers_in_non_factual_segment' });
  }
}
const tts_text = segments.map(s => s.spoken_text).join('\n\n');
if (tts_text.length > CFG.MAX_TTS_CHARS) issues.push({ where: 'script', reason: `too_long:${tts_text.length}>${CFG.MAX_TTS_CHARS}` });
const voice = CH.voice || VOICE_PRESETS[P.voice_preset] || VOICE_PRESETS.neutral_news;
if (issues.length) {
  throw new Error(`TTS BLOCKED - ${issues.length} issue(s): ` + issues.map(i => `[${i.where}] ${i.reason}`).join(' | ') + `\nREPORT ${JSON.stringify({ run_id: S.run_id, issues, dropped_stories })}`);
}
const speed = Math.min(1.2, Math.max(0.7, voice.voice_settings.speed));
// ---- recording in parts (ElevenLabs limit per request); parts are joined after recording ----------
const chunks = [], marks = []; // marks: segment -> chunk + character offset (timestamps come back per character)
let cur = '';
for (const sg of segments) {
  // pauses from the voice guide: longer pauses = sentences on their own lines (the voice breathes there)
  const body = CH.pause_s >= 0.5 ? sg.spoken_text.split(/(?<=[.!?])\s+/).join('\n\n') : CH.pause_s >= 0.4 ? sg.spoken_text.split(/(?<=[.!?])\s+/).join('\n') : sg.spoken_text;
  const said = (sg.kind === 'hook' && CH.delivery_tag ? CH.delivery_tag : '') + body;
  if (cur && (cur + '\n\n' + said).length > CFG.TTS_CHUNK_CHARS) { chunks.push(cur); cur = ''; }
  const offset = cur ? cur.length + 2 + (said.length - body.length) : said.length - body.length; // where the spoken words start (after a delivery tag)
  marks.push({ index: sg.index, chunk: chunks.length, offset, head: body.slice(0, 24) });
  cur = cur ? cur + '\n\n' + said : said;
}
if (cur) chunks.push(cur);
const result = {
  run_id: S.run_id,
  gate: { status: 'passed', checked_segments: segments.length },
  story_claims: storyPlans.map(sp => ({ story_id: sp.story.story_id, title: sp.story.title, used_claim_ids: [...new Set(segments.filter(sg => sg.story_id === sp.story.story_id).flatMap(sg => sg.claim_ids))], available_verified: sp.available_verified, rejected: sp.rejected })),
  script_checks, llm_usage: llmUsage, plan: W ? { mode: W.plan.mode, interpretation: W.plan.interpretation, changes: W.plan.changes, stories: W.stories.map(st => ({ story_id: st.story_id, title: st.title, role: st.role, angle: st.angle, words: st.words, claims: st.claims.length, why: st.why || [] })) } : null,
  dropped_stories, trimmed_for_time: trimmed,
  claims: Object.values(claimById),
  script: { segments, tts_text, chars: tts_text.length, words: words(tts_text), est_duration_seconds: Math.round(words(tts_text) / WPS) },
  tts: { enabled: !!CFG.SYNTHESIZE_AUDIO, marks, voice_id: voice.voice_id, voice_name: voice.name, host: CH.name, pause_s: CH.pause_s, output_format: CFG.OUTPUT_FORMAT,
    body: { text: tts_text, model_id: CFG.TTS_MODEL_ID, voice_settings: { ...voice.voice_settings, speed: Number(speed.toFixed(2)) } } },
};
return chunks.map((text, i) => ({ json: i === 0
  ? { ...result, tts: { ...result.tts, part: 0, parts: chunks.length, body: { ...result.tts.body, text } } }
  : { run_id: S.run_id, tts: { ...result.tts, part: i, parts: chunks.length, body: { ...result.tts.body, text } } } }));
