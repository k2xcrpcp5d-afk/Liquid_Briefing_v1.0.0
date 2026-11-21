// ============================================================================
// WORKFLOW B — NODE: "Validate claims (batch)"   (Code node, Run Once for All Items)
// Same checks as M2 "Validate claims" (copied at build time), applied to every
// newly extracted article. Output: rows for the lb_claims cache, or one { _none } item.
// ============================================================================
const reqs = $('Build extraction requests').all().map(i => i.json);
const arts = Object.fromEntries($('Get articles').all().map(i => i.json).filter(a => a.article_id).map(a => [a.article_id, a]));
const PROMPT_VERSION = $('Select stories').first().json.prompt_version;
const PRICE = { 'gpt-5-mini': { input_per_1m: 0.25, cached_input_per_1m: 0.025, output_per_1m: 2.0 } }; // list prices, VERIFY

/*__VALIDATE_CORE__*/

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
