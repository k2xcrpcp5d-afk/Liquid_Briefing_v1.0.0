// ============================================================================
// WORKFLOW B v2 — NODE: "Collect sources"   (Code node, Run Once for All Items)
// Reads the research answers (one per angle), drops duplicate facts and sources from
// outside the trusted list, and emits one item per source page to fetch for the check.
// ============================================================================
const plans = $('Plan research').all().map(i => i.json);
const answers = $input.all().map(i => { const j = i.json; if (j && typeof j.data === 'string') { try { return JSON.parse(j.data); } catch (e) {} } return j; });
const host = u => { const m = String(u || '').match(/^https?:\/\/([^\/?#:]+)/i); return m ? m[1].toLowerCase().replace(/^(www|amp|m)\./, '') : ''; };
const allowed = (h, local) => (local && /^(127\.0\.0\.1|localhost)$/.test(h)) || (!!h && plans[0].domains.some(d => h === d || h.endsWith('.' + d)));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// the model sometimes appends markdown citations ("([bbc.com](https://...))") to statements: they must not be checked as content
const unlink = s => String(s || '').replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+([.,;:])/g, '$1').replace(/\s+/g, ' ').trim();
const stories = [], facts = [], usage = [], notes = [];
let answerable = true, searches = 0, n = 0;
const seenFact = new Set();
answers.forEach((R, i) => {
  const angle = plans[i] ? plans[i].angle : 'extra';
  let text = '';
  for (const o of R.output || []) if (o.type === 'message') for (const c of o.content || []) if (c.type === 'output_text') text += c.text;
  searches += (R.output || []).filter(o => o.type === 'web_search_call').length;
  if (R.usage) usage.push({ stage: 'research_' + angle, model: R.model || plans[0].body.model, input_tokens: R.usage.input_tokens || 0, cached_input_tokens: (R.usage.input_tokens_details && R.usage.input_tokens_details.cached_tokens) || 0, output_tokens: R.usage.output_tokens || 0, web_searches: (R.output || []).filter(o => o.type === 'web_search_call').length });
  let data;
  try { data = JSON.parse(text); } catch (e) { notes.push(angle + ': research returned no usable JSON'); return; }
  if (angle === 'answer' && data.answerable === false) { answerable = false; if (data.unanswered_note) notes.push(data.unanswered_note); }
  (data.stories || []).forEach((s, si) => {
    const key = angle + '_' + si;
    const ids = [];
    for (const f0 of s.facts || []) {
      const f = { ...f0, statement: unlink(f0.statement) };
      const k = norm(f.statement).slice(0, 90);
      if (!k || seenFact.has(k)) continue;
      seenFact.add(k);
      const id = 'f' + (++n);
      const sources = (f.sources || []).map(src => ({ url: String(src.url || '').trim(), publisher: src.publisher, quote: unlink(src.quote), domain: host(src.url) }))
        .map(src => ({ ...src, allowed: allowed(src.domain, plans[0].local) })).slice(0, 3);
      facts.push({ id, story_key: key, angle, statement: f.statement, kind: f.kind, attribution: f.attribution, date: f.date, sources });
      ids.push(id);
    }
    if (ids.length) stories.push({ key, angle, title: s.title, summary: s.summary, fact_ids: ids });
  });
});
const urls = [...new Set(facts.flatMap(f => f.sources.filter(s => s.allowed).map(s => s.url)))].slice(0, 60);
const meta = { stories, facts, usage, notes, answerable, searches, ms_research: Date.now() - plans[0].t0, words: plans[0].words, wps: plans[0].wps, factsTarget: plans[0].factsTarget };
if (!urls.length) return [{ json: { url: 'about:blank', meta } }];
return urls.map((url, i) => ({ json: i === 0 ? { url, meta } : { url } }));
