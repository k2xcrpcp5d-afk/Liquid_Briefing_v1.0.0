// ============================================================================
// WORKFLOW B v2 — NODE: "Plan research"   (Code node, Run Once for All Items)
// Turns the listener's request, length and host into 1-3 parallel web-research briefs
// (OpenAI Responses API + web_search, restricted to trusted outlets that we can read
// back for the fact check). The longer the episode, the more angles and facts.
// ============================================================================
const F = $input.first().json;
const P = F.profile;
const CFG = { MODEL: 'gpt-6.1-terra', EFFORT: 'low', LOCAL: false /*__LOCAL__*/ };
const LANG = { en: 'English', de: 'German', nl: 'Dutch' }[P.language] || 'English';
const seconds = P.duration_seconds;
// measured speaking rate (live runs 21 Nov 2026): words per second at voice speed 1.0, times the host's voice speed
const speed = (P.character && P.character.voice && P.character.voice.voice_settings && P.character.voice.voice_settings.speed) || 1;
const wps = Number((({ en: 2.8, de: 1.9, nl: 2.55 }[P.language] || 2.6) * speed).toFixed(2));
const words = Math.round(seconds * wps);
const factsTarget = Math.max(8, Math.min(48, Math.round(words / 26)));
const today = new Date().toISOString().slice(0, 10);
// Trusted outlets whose article pages n8n can fetch for the quote check (tested 21 Nov 2026), plus official sources.
// Reuters, AP, FT, WSJ, Bloomberg, NYT, Axios block automated reading, so their facts would never pass the check;
// the research finds the same news via readable outlets that carry it (DW, Guardian, tagesschau, NOS ...).
const DOMAINS = ['bbc.com', 'bbc.co.uk', 'theguardian.com', 'npr.org', 'politico.eu', 'euronews.com', 'aljazeera.com', 'cbc.ca', 'abc.net.au', 'independent.co.uk', 'sky.com', 'time.com', 'cnbc.com', 'fortune.com', 'businessinsider.com',
  'dw.com', 'tagesschau.de', 'zdf.de', 'deutschlandfunk.de', 'br.de', 'ndr.de', 'spiegel.de', 'faz.net', 'sueddeutsche.de', 'handelsblatt.com', 'wiwo.de', 'tagesspiegel.de', 'n-tv.de', 'stern.de', 'manager-magazin.de', 'capital.de', 'boerse.de',
  'nzz.ch', 'srf.ch', 'orf.at', 'derstandard.at', 'nos.nl', 'nrc.nl', 'fd.nl', 'businessinsider.nl', 'vrt.be', 'lemonde.fr',
  'theverge.com', 'arstechnica.com', 'techcrunch.com', 'wired.com', 'nature.com', 'sportschau.de', 'skysports.com',
  'who.int', 'un.org', 'europa.eu', 'ecb.europa.eu', 'federalreserve.gov', 'bundesbank.de', 'dnb.nl', 'destatis.de', 'cbs.nl', 'bls.gov', 'bea.gov', 'imf.org', 'worldbank.org', 'oecd.org',
  'bundesregierung.de', 'bundestag.de', 'rijksoverheid.nl', 'gov.uk', 'nasa.gov', 'esa.int'];
const TOPIC_TEXT = { fx_central_banks: 'central banks and currencies', macro: 'economy', stocks: 'companies and markets', crypto: 'crypto', ai_tech: 'AI and tech', commodities: 'energy and commodities', world_politics: 'world politics', personal_finance: 'personal finances, prices and rents', lifestyle: 'culture and society' };
const COUNTRY = P.country || null;
const interests = [...(P.topics || []).map(t => TOPIC_TEXT[t] || t), ...(P.entities || [])].join(', ');
const question = P.listener_question;

// angles: what each parallel research call is responsible for
const share = (n) => Math.max(4, Math.round(factsTarget * n));
const angles = [];
if (question) {
  angles.push({ key: 'answer', facts: share(seconds >= 300 ? 0.45 : seconds >= 180 ? 0.65 : 1), brief: 'Answer the listener\'s request directly: the latest developments, the key facts and numbers, and who said what. Start with what answers the question best.' });
  if (seconds >= 180) angles.push({ key: 'context', facts: share(seconds >= 300 ? 0.3 : 0.35), brief: 'Context for the request: how we got here, earlier events with their dates, the numbers that explain the scale, and what different sides say (attributed).' });
  if (seconds >= 300) angles.push({ key: 'side', facts: share(0.25), brief: 'Interesting side facts and related developments that make the story richer for the listener (surprising details, comparisons, what happens next, people involved) - all clearly connected to the request.' });
} else {
  angles.push({ key: 'top', facts: share(seconds >= 300 ? 0.5 : 0.7), brief: 'The most important news of the last 24 hours for this listener' + (interests ? ' (interests: ' + interests + ')' : '') + (COUNTRY ? ', with the listener\'s country ' + COUNTRY + ' in mind' : '') + '. Several different stories, the biggest first.' });
  angles.push({ key: 'more', facts: share(seconds >= 300 ? 0.3 : 0.3), brief: 'Further relevant news of the last 48 hours for this listener' + (interests ? ' (' + interests + ')' : '') + ', different from the day\'s two or three biggest headlines.' });
  if (seconds >= 300) angles.push({ key: 'context', facts: share(0.2), brief: 'Background and context for today\'s biggest headlines: earlier events with dates, the numbers behind them, what happens next.' });
}

const SYSTEM = (a) => [
  'You are the research desk of Liquid Briefing, a personal audio news podcast. Today is ' + today + '.',
  'The episode is ' + Math.round(seconds / 60) + ' minutes in ' + LANG + '. Your part of the research: ' + a.brief,
  'Search the web. Only trustworthy, established outlets and official sources are available to you.',
  'Prefer news from the last 72 hours. Older material only as background, and give its date.',
  'For EVERY fact give one or two sources. For each source copy an EXACT quote from the article text: one or two complete sentences, verbatim, in the article language. No paraphrase, no ellipsis, no headlines. The quote must contain every number in the statement.',
  'Statements: one checkable fact each, written in English, with who / what / when, plain text without links or citation marks. Opinions, motives and explanations only as attributed views (attribution = who says it). No investment advice, no tips to buy or sell.',
  'Collect about ' + a.facts + ' facts, grouped into stories. If the request cannot be answered from reliable sources, set answerable=false, say why in unanswered_note, and still collect the closest relevant facts.',
].join('\n');
const USER = 'Listener request: ' + (question || 'What is the most important news for me today?') + (interests ? '\nListener interests: ' + interests : '') + (COUNTRY ? '\nListener country: ' + COUNTRY : '');
const S = { type: 'string' }, SN = { type: ['string', 'null'] };
const schema = { type: 'object', additionalProperties: false, required: ['answerable', 'unanswered_note', 'stories'], properties: {
  answerable: { type: 'boolean' }, unanswered_note: SN,
  stories: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'summary', 'facts'], properties: {
    title: S, summary: S,
    facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['statement', 'kind', 'attribution', 'date', 'sources'], properties: {
      statement: S, kind: { type: 'string', enum: ['fact', 'number', 'view', 'background'] }, attribution: SN, date: SN,
      sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'publisher', 'quote'], properties: { url: S, publisher: S, quote: S } } } } } } } } } } };

return angles.map(a => ({ json: {
  angle: a.key, facts_wanted: a.facts, words, wps, factsTarget, domains: DOMAINS, local: CFG.LOCAL, t0: Date.now(),
  body: { model: CFG.MODEL, instructions: SYSTEM(a), input: USER,
    tools: [{ type: 'web_search', filters: { allowed_domains: DOMAINS } }], include: ['web_search_call.action.sources'],
    text: { format: { type: 'json_schema', name: 'research', strict: true, schema } }, reasoning: { effort: CFG.EFFORT }, max_output_tokens: 20000 },
} }));
