// ============================================================================
// NODE: "Prepare cluster checks"   (Code node, Run Once for All Items)
// Escalation step: only clusters where a wrong merge would matter (>= 2 outlets
// or >= 3 articles) go to a small model, which may SPLIT them. It never merges.
// Output: one OpenAI request per cluster, or one { skip: true } item.
// ============================================================================
const CHECK = {
  USE_LLM_CLUSTER_CHECK: false,   // true = needs the OpenAI credential on "OpenAI cluster check"
  OPENAI_MODEL: 'gpt-5-mini',
  REASONING_EFFORT: 'low',
  MIN_OUTLETS: 2,
  MIN_ARTICLES: 3,
  MAX_ARTICLES_PER_CHECK: 15,     // larger clusters: first 15 by time are checked, the rest keep the majority group
};

const all = $input.all().map(i => i.json);
const stories = all.filter(x => x._type === 'story' && x.kind === 'event');
const arts = Object.fromEntries(all.filter(x => x._type === 'article').map(a => [a.article_id, a]));
const toCheck = stories.filter(s => s.independent_outlet_count >= CHECK.MIN_OUTLETS || s.article_ids.length >= CHECK.MIN_ARTICLES);

if (!CHECK.USE_LLM_CLUSTER_CHECK || !toCheck.length) {
  return [{ json: { skip: true, reason: CHECK.USE_LLM_CLUSTER_CHECK ? 'nothing to check' : 'LLM cluster check disabled', candidates: toCheck.length, config: CHECK } }];
}

const SYSTEM = `You check groups of news articles that a keyword algorithm put together. Decide which articles report the SAME news event: the same actors doing the same thing at the same time (for example one data release, one lawsuit filing, one resignation, one IPO pricing).

Split them when they are different events, even if they share a company, person or topic:
- a market reaction story (stocks/currency moving afterwards) is separate from the event that moved it
- a preview ("ahead of", "what to expect") is separate from the result
- a later development (new statement, new decision, new filing) is a separate event
- opinion, analysis or "stocks to buy" pieces belong with the event only if their main subject is that event

Use only the headline, outlet, time and excerpt given. Return every article number exactly once.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['article_numbers', 'event_label', 'confidence'],
        properties: {
          article_numbers: { type: 'array', items: { type: 'integer' } },
          event_label: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

return toCheck.map(s => {
  const ids = s.article_ids.slice(0, CHECK.MAX_ARTICLES_PER_CHECK);
  const lines = ids.map((id, k) => {
    const a = arts[id];
    return `${k + 1}. [${a.publication} | ${a.published_at.slice(0, 16).replace('T', ' ')} UTC] ${a.headline} — ${(a.excerpt || '').slice(0, 240)}`;
  });
  const body = {
    model: CHECK.OPENAI_MODEL,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: lines.join('\n') }],
    response_format: { type: 'json_schema', json_schema: { name: 'cluster_check', strict: true, schema: SCHEMA } },
    max_completion_tokens: 2000,
  };
  if (/^(gpt-5|o\d)/.test(CHECK.OPENAI_MODEL) && CHECK.REASONING_EFFORT) body.reasoning_effort = CHECK.REASONING_EFFORT;
  return { json: { story_id: s.story_id, checked_ids: ids, openai_body: body, config: CHECK } };
});
