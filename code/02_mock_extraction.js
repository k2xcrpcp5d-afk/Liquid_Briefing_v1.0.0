// ============================================================================
// NODE: "Mock extraction"   (Code node) - only runs when CONFIG.USE_MOCK_LLM = true
// Returns the same shape as an OpenAI Chat Completions response, so
// "Validate claims" cannot tell the difference. Matches the fictional fixture.
// ============================================================================
const prep = $('Prepare article & request').first().json;

const extraction = {
  event: {
    event_type: 'macro_data_release',
    primary_entities: ['Norland', 'Norland Statistics Office', 'Norland krone'],
    event_date_or_period: 'October 2026',
    one_line_summary: 'Norland producer prices rose more than expected in October.',
  },
  claims: [
    {
      local_id: 'c1',
      statement: "Norland's producer prices rose 0.4% in October from the previous month, according to the Norland Statistics Office.",
      claim_type: 'data_release',
      evidence_quote: 'Producer prices in Norland rose 0.4% in October from the previous month, the Norland Statistics Office said on Thursday',
      attribution: null,
      figure: { value: 0.4, value_text: '0.4%', unit: 'percent', currency: null, period: 'October 2026', comparison_basis: 'month_over_month', direction: 'up', measure: 'actual' },
    },
    {
      local_id: 'c2',
      statement: 'Economists had expected a smaller increase of 0.2% from the previous month.',
      claim_type: 'forecast_or_estimate',
      evidence_quote: 'rose 0.4% in October from the previous month, the Norland Statistics Office said on Thursday, faster than the 0.2% increase economists polled by Fictional Markets Wire had expected',
      attribution: 'economists polled by Fictional Markets Wire',
      figure: { value: 0.2, value_text: '0.2%', unit: 'percent', currency: null, period: 'October 2026', comparison_basis: 'month_over_month', direction: 'up', measure: 'estimate' },
    },
    {
      local_id: 'c3',
      statement: 'Compared with October last year, Norland producer prices were up 2.6%.',
      claim_type: 'data_release',
      evidence_quote: 'Compared with October last year, producer prices were up 2.6%',
      attribution: null,
      figure: { value: 2.6, value_text: '2.6%', unit: 'percent', currency: null, period: 'October 2026', comparison_basis: 'year_over_year', direction: 'up', measure: 'actual' },
    },
    {
      local_id: 'c4',
      statement: 'Excluding food and energy, Norland producer prices rose 0.1% month-on-month.',
      claim_type: 'data_release',
      evidence_quote: 'Excluding food and energy, prices increased 0.1% month-on-month.',
      attribution: null,
      figure: { value: 0.1, value_text: '0.1%', unit: 'percent', currency: null, period: 'October 2026', comparison_basis: 'month_over_month', direction: 'up', measure: 'actual' },
    },
    {
      local_id: 'c5',
      statement: 'By 15:00 local time, the Norland krone was up 0.5% against the euro.',
      claim_type: 'price_move',
      evidence_quote: 'By 15:00 local time the krone was up 0.5% against the euro, trading at 11.42 krone per euro.',
      attribution: null,
      figure: { value: 0.5, value_text: '0.5%', unit: 'percent', currency: null, period: '19 November 2026', comparison_basis: 'intraday', direction: 'up', measure: 'actual' },
    },
    {
      local_id: 'c6',
      statement: "Analysts at Fictional Bank said the stronger-than-expected reading made a rate cut at the central bank's December meeting less likely.",
      claim_type: 'attributed_view',
      evidence_quote: "Analysts at Fictional Bank said the stronger-than-expected reading made a rate cut at the central bank's December meeting less likely.",
      attribution: 'Analysts at Fictional Bank',
      figure: null,
    },
  ],
};

return [{
  json: {
    id: 'mock-completion',
    model: `${prep.config.OPENAI_MODEL} (MOCK)`,
    mocked: true,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(extraction), refusal: null } }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } },
  },
}];
