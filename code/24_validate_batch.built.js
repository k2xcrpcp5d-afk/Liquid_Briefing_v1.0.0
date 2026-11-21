// ============================================================================
// WORKFLOW B — NODE: "Validate claims (batch)"   (Code node, Run Once for All Items)
// Same checks as M2 "Validate claims" (copied at build time), applied to every
// newly extracted article. Output: rows for the lb_claims cache, or one { _none } item.
// ============================================================================
const reqs = $('Build extraction requests').all().map(i => i.json);
const arts = Object.fromEntries($('Get articles').all().map(i => i.json).filter(a => a.article_id).map(a => [a.article_id, a]));
const PROMPT_VERSION = $('Select stories').first().json.prompt_version;
const PRICE = { 'gpt-5-mini': { input_per_1m: 0.25, cached_input_per_1m: 0.025, output_per_1m: 2.0 } }; // list prices, VERIFY

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
const norm = s => String(s || '')
  .normalize('NFKC')
  .replace(/[‘’‚‛′]/g, "'")
  .replace(/[“”„‟″«»]/g, '"')
  .replace(/[‐-―−]/g, '-')
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// Numbers: times kept as "hh:mm" tokens; decimal separator depends on language.
function extractNumbers(text, lang) {
  const t = norm(text);
  const times = [];
  const rest = t.replace(/\b(\d{1,2}):(\d{2})\b/g, m => { times.push(m); return ' '; });
  const decimalComma = ['de', 'nl', 'fr', 'es', 'it'].includes(lang);
  const SCALE = { trillion: 1e12, tn: 1e12, billion: 1e9, bn: 1e9, milliarden: 1e9, miljard: 1e9, million: 1e6, millionen: 1e6, miljoen: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };
  const nums = [];
  const re = /-?\d+(?:[.,]\d+)*/g; let m;
  while ((m = re.exec(rest)) !== null) {
    const tok = m[0];
    const raw = decimalComma ? Number(tok.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : Number(tok.replace(/,(?=\d{3}\b)/g, ''));
    if (!Number.isFinite(raw)) continue;
    // "59 million", "$10.5bn", "65k" -> scaled value; the raw number is kept too
    const sc = rest.slice(m.index + tok.length).match(/^\s?(trillion|tn|billion|bn|milliarden|miljard|million|millionen|miljoen|mn|m|thousand|k)\b/);
    const v = sc ? raw * SCALE[sc[1]] : raw;
    nums.push({ tok: sc ? tok + ' ' + sc[1] : tok, v, raw, isYear: !sc && Number.isInteger(raw) && raw >= 1900 && raw <= 2100 && !/[.,]/.test(tok) });
  }
  return { nums, times };
}
const close = (a, b) => Math.abs(Math.abs(a) - Math.abs(b)) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const numIn = (x, list) => list.some(n => close(n.v, x) || close(n.raw, x));

const L = {
  basis: {
    month_over_month: [/month[- ]on[- ]month/, /month[- ]over[- ]month/, /\bm\/m\b/, /\bmom\b/, /\b(from|than|over|on|versus|vs\.?) (the |a )?(previous|prior|preceding|last) month/, /from a month (earlier|before|ago)/, /\bon the month\b/, /\b(during|in) the month\b/, /\bmonthly\b/, /vormonat/, /monatlich/, /ten opzichte van (de )?vorige maand/, /maand[- ]op[- ]maand/, /op maandbasis/],
    year_over_year: [/year[- ]on[- ]year/, /year[- ]over[- ]year/, /\by\/y\b/, /\byoy\b/, /\bannual(ly|i[sz]ed)?\b/, /\bannual rate\b/, /\b(a|one) year (earlier|ago|before)\b/, /\blast year\b/, /\b(previous|prior) year\b/, /\b(12|twelve)[- ]months?\b/, /\bon the year\b/, /vorjahr/, /jahresvergleich/, /jahresrate/, /jaar[- ]op[- ]jaar/, /op jaarbasis/, /vorig jaar/],
    quarter_over_quarter: [/quarter[- ]on[- ]quarter/, /quarter[- ]over[- ]quarter/, /\bq\/q\b/, /\bqoq\b/, /\b(previous|prior|preceding|last) quarter\b/, /vorquartal/, /kwartaal[- ]op[- ]kwartaal/, /vorig kwartaal/],
    year_to_date: [/year[- ]to[- ]date/, /\bytd\b/, /so far this year/, /since the start of the year/, /seit jahresbeginn/, /sinds (het )?begin van het jaar/],
    intraday: [/\bintraday\b/, /\b(by|at|as of|um|om) \d{1,2}[:.]\d{2}\b/, /\blocal time\b/, /\b(gmt|cet|et|bst|utc)\b/, /\bin (early|late|morning|afternoon|midday|european|asian|us|new york|london) trading\b/, /at the time of writing/, /im (frühen |späten )?handel/, /tijdens de handel/],
    close: [/\bclos(ed|e|ing)\b/, /\bsettled\b/, /schluss/, /schloss/, /\bslot\b/, /\bsloot\b/],
  },
  conflicts: {
    month_over_month: ['year_over_year', 'quarter_over_quarter', 'year_to_date'],
    year_over_year: ['month_over_month', 'quarter_over_quarter', 'year_to_date'],
    quarter_over_quarter: ['month_over_month', 'year_over_year', 'year_to_date'],
    year_to_date: ['month_over_month', 'year_over_year', 'quarter_over_quarter'],
    intraday: ['close'],
    close: ['intraday'],
  },
  up: /\b(rose|rise[sn]?|rising|increas(e|ed|es|ing)|up|gain(ed|s)?|climb(ed|s)?|jump(ed|s)?|higher|advanc(ed|es)|accelerat(ed|es|ing)|strengthen(ed|s)?|grew|grow(n|s|th)?|stieg|gestiegen|steigt|legte zu|höher|gestegen|steeg|stijgt|hoger)\b/,
  down: /\b(fell|fall(s|en|ing)?|declin(e|ed|es|ing)|drop(ped|s)?|down|lower|slipp?(ed|s)?|slid|sank|decreas(e|ed|es|ing)|weaken(ed|s)?|lost|shrank|contract(ed|ion)?|fiel|gefallen|gesunken|niedriger|gedaald|daalde|daalt)\b/,
  unchanged: /\b(unchanged|flat|steady|held|stable|unverändert|stabil|ongewijzigd)\b/,
  estimate: /\b(expect(ed|ation|ations|s)?|forecast(s|ed|ers)?|estimate[sd]?|consensus|projected|anticipated|predicted|polled|survey(ed)?|odds|probabilit(y|ies)|chances?|likelihood|prognose|erwart(et|ung|ungen)|schätzung|wahrscheinlichkeit|verwacht(ing|e)?|raming|kans)\b/,
  percent: /(%|\bper ?cent\b|\bprozent\b|\bprocent\b)/,
  pp: /(percentage[- ]points?|\bpp\b|\bppts?\b|prozentpunkt|procentpunt)/,
  bp: /(basis points?|\bbps?\b|basispunkt|basispunt)/,
  speech: /\b(said|says|according to|told|noted|argued|wrote|expects?|expected|estimated?|believes?|warned|polled)\b/,
  causal: /\b(because|due to|driven by|caused by|thanks to|on the back of|triggered|sparked|fuell?ed by|led to|prompted|weighed on|boosted by|as a result|in response to|amid)\b/,
  speculative: /\b(will|is set to|are set to|likely|could|may|might)\b/,
  advice: /\b(you should|investors should|traders should|should (buy|sell|invest|consider)|consider (buying|selling|adding)|(buy|sell) (now|the dip|signal)|good time to (buy|sell|invest)|worth buying|we recommend|recommend(s|ed)? (buying|selling)|strong (buy|sell)|go (long|short)|take profits?|price target|zacks rank|kaufempfehlung|koopadvies)\b/,
  months: /\b(january|february|march|april|june|july|august|september|october|november|december|januar|februar|märz|mai|juni|juli|oktober|dezember|januari|februari|maart|mei|augustus|oktober)\b/g,
};
const CURRENCY = {
  USD: /(\$|\bus\$|\busd\b|\bdollars?\b)/, EUR: /(€|\beur\b|\beuros?\b)/, GBP: /(£|\bgbp\b|\bpounds?\b|\bsterling\b)/,
  JPY: /(¥|\bjpy\b|\byen\b)/, CHF: /(\bchf\b|\bfrancs?\b)/,
};
const anyMatch = (arr, t) => arr.some(r => r.test(t));
const monthCanon = { januar: 'january', januari: 'january', februar: 'february', februari: 'february', märz: 'march', maart: 'march', mai: 'may', mei: 'may', juni: 'june', juli: 'july', augustus: 'august', oktober: 'october', dezember: 'december' };
const monthsIn = t => [...new Set((norm(t).match(L.months) || []).map(m => monthCanon[m] || m))];

// ---------------------------------------------------------------------------
// 3. per-claim checks
// ---------------------------------------------------------------------------
function validateClaims(article, rawClaims, storyId) {
// ---------------------------------------------------------------------------
const textNorm = norm(article.text_content);
const paragraphs = article.text_content.split(/\n\s*\n/);
const seenStatements = new Set();

return rawClaims.map((c, idx) => {
  const errors = [];
  const warnings = [];
  const statement = String(c.statement || '').trim();
  const quote = String(c.evidence_quote || '').trim();
  const sN = norm(statement);
  const qN = norm(quote);
  const f = c.figure || null;

  // --- structure
  if (!statement) errors.push('empty_statement');
  if (seenStatements.has(sN)) errors.push('duplicate_statement');
  seenStatements.add(sN);

  // --- evidence: exact span in article text
  let location = null;
  if (qN.length < 20) errors.push('quote_too_short');
  if (qN.length > 600) errors.push('quote_too_long');
  if (/\.\.\.|…/.test(quote)) errors.push('ellipsis_in_quote');
  const pos = textNorm.indexOf(qN);
  if (pos === -1) errors.push('evidence_not_found_in_article');
  else {
    const pIdx = paragraphs.findIndex(p => norm(p).includes(qN));
    location = { paragraph: pIdx >= 0 ? pIdx + 1 : null, char_start_normalized: pos, char_end_normalized: pos + qN.length };
  }

  // --- numbers: every number in the statement must be in the evidence quote
  const sNum = extractNumbers(statement, 'en');
  const qNum = extractNumbers(quote, article.language);
  for (const n of sNum.nums) {
    if (n.isYear) continue; // years usually come from context; months are checked below
    if (!numIn(n.v, qNum.nums) && !numIn(n.raw, qNum.nums)) errors.push(`statement_number_not_in_evidence:${n.tok}`);
  }
  for (const tm of sNum.times) if (!qNum.times.includes(tm)) errors.push(`statement_time_not_in_evidence:${tm}`);

  // --- period: months named in the statement must appear in the quote
  const sMonths = monthsIn(statement), qMonths = monthsIn(quote);
  if (sMonths.length && qMonths.length && sMonths.some(m => !qMonths.includes(m))) errors.push(`period_month_mismatch:${sMonths.join('/')}`);
  if (sMonths.length && !qMonths.length) warnings.push('period_taken_from_context');

  // --- figure checks
  if (f) {
    const vt = norm(f.value_text);
    if (!vt) errors.push('figure_value_text_missing');
    else if (!qN.includes(vt)) errors.push(`figure_value_text_not_in_quote:${f.value_text}`);
    const vtNum = extractNumbers(f.value_text, article.language).nums[0];
    if (!vtNum || !(close(vtNum.v, f.value) || close(vtNum.raw, f.value))) errors.push(`figure_value_mismatch:${f.value}!=${f.value_text}`);
    if (!numIn(f.value, sNum.nums) && !sNum.nums.some(n => close(n.v, vtNum ? vtNum.v : NaN))) errors.push('figure_not_stated_in_statement');

    // unit
    if (f.unit === 'percent') {
      if (!L.percent.test(qN)) errors.push('unit_percent_not_in_evidence');
      if (!L.percent.test(sN) || L.pp.test(sN)) errors.push('unit_percent_not_in_statement');
    } else if (f.unit === 'percentage_points') {
      if (!L.pp.test(qN)) errors.push('unit_pp_not_in_evidence');
      if (!L.pp.test(sN)) errors.push('unit_pp_not_in_statement');
    } else if (f.unit === 'basis_points') {
      if (!L.bp.test(qN)) errors.push('unit_bp_not_in_evidence');
      if (!L.bp.test(sN)) errors.push('unit_bp_not_in_statement');
    }
    // currency
    if (f.currency) {
      const cur = String(f.currency).toUpperCase();
      const re = CURRENCY[cur] || new RegExp(`\\b${cur.toLowerCase()}\\b`);
      if (!re.test(qN)) errors.push(`currency_not_in_evidence:${cur}`);
      if (!re.test(sN)) errors.push(`currency_not_in_statement:${cur}`);
    }
    // comparison basis
    const basisLex = L.basis[f.comparison_basis];
    if (basisLex) {
      if (!anyMatch(basisLex, qN)) errors.push(`basis_not_supported_by_evidence:${f.comparison_basis}`);
      if (!anyMatch(basisLex, sN)) errors.push(`basis_missing_in_statement:${f.comparison_basis}`);
      for (const other of L.conflicts[f.comparison_basis] || []) {
        if (anyMatch(L.basis[other], sN)) errors.push(`basis_conflict_in_statement:${other}`);
        if (anyMatch(L.basis[other], qN) && !anyMatch(basisLex, qN)) errors.push(`basis_conflicts_with_evidence:${other}`);
      }
    }
    // direction
    if (f.direction === 'up' || f.direction === 'down') {
      const same = f.direction === 'up' ? L.up : L.down;
      const opp = f.direction === 'up' ? L.down : L.up;
      if (!same.test(sN)) errors.push(`direction_${f.direction}_missing_in_statement`);
      if (opp.test(sN)) errors.push('direction_conflict_in_statement');
      if (!same.test(qN)) errors.push(`direction_${f.direction}_not_in_evidence`);
    } else if (f.direction === 'unchanged') {
      if (!L.unchanged.test(sN) || !L.unchanged.test(qN)) errors.push('direction_unchanged_not_supported');
    }
    // actual vs estimate/forecast
    if (f.measure === 'estimate' || f.measure === 'forecast') {
      if (!L.estimate.test(sN)) errors.push('estimate_not_marked_in_statement');
      if (!L.estimate.test(qN)) errors.push('estimate_not_marked_in_evidence');
    } else if (L.estimate.test(sN)) {
      if (sNum.nums.filter(n => !n.isYear).length > 1) errors.push('actual_and_estimate_mixed_in_one_claim');
      else warnings.push('actual_claim_mentions_expectations');
    }
  }

  // --- attribution / causality / advice
  const isView = c.claim_type === 'attributed_view';
  if ((isView || c.claim_type === 'forecast_or_estimate') && !c.attribution) errors.push('attribution_missing');
  if (c.attribution) {
    const tokens = norm(c.attribution).split(/[^a-zà-ÿ0-9]+/).filter(w => w.length >= 5);
    if (tokens.length && !tokens.some(w => sN.includes(w))) errors.push('attribution_not_named_in_statement');
    if (isView && !L.speech.test(sN)) errors.push('attributed_view_without_speech_verb');
  }
  if (L.causal.test(sN) && !isView) errors.push('unattributed_causality');
  if (L.causal.test(sN) && isView && !L.causal.test(qN) && !L.speech.test(qN)) errors.push('causality_not_in_evidence');
  if (L.speculative.test(sN) && !c.attribution) warnings.push('speculative_wording_without_attribution');
  if (L.advice.test(sN)) errors.push('investment_advice_language');

  return {
    claim_id: `clm_${cyrb53(article.article_id + '|' + qN + '|' + sN)}`,
    local_id: c.local_id || `c${idx + 1}`,
    story_id: storyId,
    statement,
    claim_type: c.claim_type,
    attribution: c.attribution || null,
    source_article_id: article.article_id,   // attached in code, never by the model
    source_url: article.permalink,          // attached in code, never by the model
    publication: article.publication,
    figure: f,
    status: errors.length ? 'rejected' : 'verified',
    errors,
    warnings,
    internal: { evidence_quote: quote, evidence_location: location }, // never listener-facing
  };
});
}


if (reqs[0] && reqs[0].skip) return [{ json: { _none: true } }];
const resps = $input.all().map(i => i.json);
const rows = resps.map((resp, k) => {
  const req = reqs[k];
  const a = arts[req.article_id];
  const article = { article_id: a.article_id, permalink: a.permalink, publication: a.publication, language: a.language, headline: a.headline, text_content: a.text_content };
  let extraction_error = null, raw = [];
  const ch = (resp.choices || [])[0];
  if (!ch) extraction_error = 'no_choices';
  else if (ch.message && ch.message.refusal) extraction_error = 'refusal';
  else if (ch.finish_reason === 'length') extraction_error = 'truncated_output';
  let summary = null;
  if (!extraction_error) { try { const parsed = JSON.parse(ch.message.content); raw = parsed.claims || []; summary = parsed.event && parsed.event.one_line_summary ? String(parsed.event.one_line_summary).slice(0, 300) : null; } catch (e) { extraction_error = 'invalid_json'; } }
  const claims = extraction_error ? [] : validateClaims(article, raw, req.story_id);
  const u = resp.usage || {};
  const inTok = u.prompt_tokens || 0, cTok = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0, outTok = u.completion_tokens || 0;
  const pr = PRICE[req.model];
  return { json: {
    article_id: a.article_id, story_id: req.story_id, content_hash: a.content_hash, prompt_version: PROMPT_VERSION, model: resp.model || req.model,
    extraction_error, summary, claims_json: JSON.stringify(claims),
    verified_count: claims.filter(c => c.status === 'verified').length, rejected_count: claims.filter(c => c.status === 'rejected').length,
    input_tokens: inTok, cached_input_tokens: cTok, output_tokens: outTok,
    est_cost_usd: pr ? Number((((inTok - cTok) * pr.input_per_1m + cTok * pr.cached_input_per_1m + outTok * pr.output_per_1m) / 1e6).toFixed(6)) : null,
    created_at: new Date().toISOString(),
  } };
});
return rows;
