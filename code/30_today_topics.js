// ============================================================================
// WORKFLOW C — NODE: "Today's topics"   (Code node, Run Once for All Items)
// Picks the 4 most important current stories from 4 DIFFERENT areas, so the
// listener can add any of them to today's briefing. Same news window as
// Workflow B ("Select stories"). No LLM, reads only lb_stories.
// ============================================================================
const CFG = { BRIEFING_DATE: '2026-11-19', WINDOW_HOURS: 48, PICKS: 4 };
const AREAS = [
  ['macro', 'Economy', ['Market Overview', 'Inflation', 'Economic Highlights', 'Economy', 'Fed', 'ECB', 'BoJ', 'BoC', 'Yields']],
  ['stocks', 'Companies & markets', ['Stock market', 'Indices', 'IPO', 'Mergers & Acquisitions', 'Business', 'Markets', 'Stocks', 'Market News', 'Stocks in the News']],
  ['ai_tech', 'Tech & AI', ['Tech', 'Artificial intelligence', 'Artificial Intelligence', 'Technology', 'CyberSecurity', 'Social Media']],
  ['crypto', 'Crypto', ['Crypto', 'Bitcoin', 'XRP', 'Solana', 'Altcoins', 'DeFi', 'Ethereum', 'Cryptocurrency']],
  ['world_politics', 'World & politics', ['World', 'Politics', 'National', 'Political']],
  ['commodities', 'Energy & commodities', ['Commodities', 'Precious metals', 'Energy', 'Gold', 'Oil']],
  ['fx_central_banks', 'Currencies', ['JPY', 'USD', 'Forex', 'RBA', 'RBNZ']],
];
const ADVICE = /\b(stocks? to buy|good stock to buy|buy now|should you buy|is it time to buy|strong buy|top picks?)\b/i;
const J = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch (e) { return []; } };
const briefT = Date.parse('2026-11-19T09:00:00Z'); // "now" = just after the last article in the feed (08:46 UTC)
const winStart = briefT - CFG.WINDOW_HOURS * 3600000;

const best = {}; // area -> best story
for (const it of $input.all()) {
  const s = it.json;
  if (!s.story_id || s.kind !== 'event' || ADVICE.test(s.title || '')) continue;
  const last = Date.parse(s.last_seen);
  if (!(last >= winStart && last < briefT)) continue;
  const cats = J(s.provider_categories);
  const area = AREAS.find(([, , c]) => cats.some(x => c.includes(x)));
  if (!area) continue;
  const ageH = (briefT - last) / 3600000;
  const score = Number(s.editorial_score || 0) + 0.5 * (Number(s.independent_outlet_count || 1) - 1) - ageH / 48;
  if (!best[area[0]] || score > best[area[0]].score) {
    best[area[0]] = { story_id: s.story_id, area: area[0], area_label: area[1], title: s.title, outlets: J(s.outlets), outlet_count: Number(s.independent_outlet_count || 1), age_hours: Math.round(ageH), score: Number(score.toFixed(2)) };
  }
}
const topics = Object.values(best).sort((a, b) => b.score - a.score).slice(0, CFG.PICKS);
return [{ json: { briefing_date: CFG.BRIEFING_DATE, topics } }];
