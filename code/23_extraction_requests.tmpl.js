// ============================================================================
// WORKFLOW B — NODE: "Build extraction requests"   (Code node, Run Once for All Items)
// One OpenAI request per selected story whose claims are NOT cached yet.
// Prompt + schema are copied from M2 (01_prepare.js) at build time.
// ============================================================================
const S = $('Select stories').first().json;
const arts = Object.fromEntries($('Get articles').all().map(i => i.json).filter(a => a.article_id).map(a => [a.article_id, a]));
const CONFIG = { MAX_CLAIMS: 12, OPENAI_MODEL: 'gpt-5-mini', OPENAI_REASONING_EFFORT: 'low', OPENAI_MAX_COMPLETION_TOKENS: 7000 };

/*__EXTRACT_PROMPT__*/

if (!S.to_extract.length) return [{ json: { skip: true, reason: 'all claims cached', cached: S.cached.length } }];

const isReasoningModel = /^(gpt-5|o\d)/i.test(CONFIG.OPENAI_MODEL);
return S.to_extract.map(t => {
  const a = arts[t.article_id];
  const userMessage =
    `PUBLICATION: ${a.publication}\nPUBLISHED_AT: ${a.published_at}\nLANGUAGE: ${a.language}\n` +
    `HEADLINE (context only, not evidence): ${a.headline}\n\n<<<ARTICLE TEXT>>>\n${a.text_content}\n<<<END ARTICLE TEXT>>>`;
  const body = {
    model: CONFIG.OPENAI_MODEL,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
    response_format: { type: 'json_schema', json_schema: { name: 'claim_extraction', strict: true, schema: CLAIM_SCHEMA } },
    max_completion_tokens: CONFIG.OPENAI_MAX_COMPLETION_TOKENS,
  };
  if (isReasoningModel && CONFIG.OPENAI_REASONING_EFFORT) body.reasoning_effort = CONFIG.OPENAI_REASONING_EFFORT;
  return { json: { story_id: t.story_id, article_id: t.article_id, model: CONFIG.OPENAI_MODEL, openai_body: body } };
});
