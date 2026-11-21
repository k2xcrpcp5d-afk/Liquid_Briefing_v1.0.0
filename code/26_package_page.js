// ============================================================================
// WORKFLOW B — NODE: "Package briefing page"   (Code node, Run Once for All Items)
// Builds the result: JSON (transcript, decisions, cost) + binary "briefing_page"
// (a self-contained HTML page with the MP3 embedded). No source passages are
// shown (licence) - only our own sentences and links to the publisher.
// ============================================================================
const S = $('Select stories').first().json;
const G = $('Build script & gate').first().json;
const arts = Object.fromEntries($('Get articles').all().map(i => i.json).filter(a => a.article_id).map(a => [a.article_id, a]));
const newRows = $('Validate claims (batch)').all().map(i => i.json).filter(r => r.article_id);
const P = S.profile;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- audio -------------------------------------------------------------------------------
// the script is recorded in parts (ElevenLabs limit per request): join them in order
const items = $input.all();
let audioB64 = null, audioBin = null, segStart = {};
if (G.tts.enabled) {
  const stripId3 = b => (b.length > 10 && b.slice(0, 3).toString() === 'ID3' ? b.slice(10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f))) : b);
  // the first MPEG frame of each part may be a Xing/Info header that states THAT PART's length; players would take it
  // for the whole file. Drop it (it carries no audio) so the joined file reports its real duration.
  const dropInfoFrame = b => {
    if (b.length < 200 || b[0] !== 0xff || (b[1] & 0xe0) !== 0xe0) return b;
    const head = b.slice(0, 200).toString('latin1');
    if (!/Xing|Info/.test(head)) return b;
    const ver = (b[1] >> 3) & 3, layer = (b[1] >> 1) & 3, brIdx = b[2] >> 4, srIdx = (b[2] >> 2) & 3, pad = (b[2] >> 1) & 1;
    if (layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return b;
    const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[ver];
    if (!SR) return b;
    const br = (ver === 3 ? BR1 : BR2)[brIdx] * 1000, sr = SR[srIdx];
    const len = Math.floor((ver === 3 ? 144 : 72) * br / sr) + pad;
    return len > 0 && len < b.length ? b.slice(len) : b;
  };
  const bufs = [], aligns = [];
  for (let i = 0; i < items.length; i++) {
    let b, al = null;
    if (items[i].json && items[i].json.audio_base64) { b = Buffer.from(items[i].json.audio_base64, 'base64'); al = items[i].json.alignment || null; }
    else if (items[i].binary && items[i].binary.audio) b = await this.helpers.getBinaryDataBuffer(i, 'audio');
    else throw new Error('ElevenLabs returned no audio for part ' + (i + 1));
    const clean = i === 0 ? (() => { const s0 = stripId3(b); return Buffer.concat([b.slice(0, b.length - s0.length), dropInfoFrame(s0)]); })() : dropInfoFrame(stripId3(b));
    bufs.push(clean); aligns.push(al);
  }
  // segment start times: each part's offset (CBR 64 kbit/s: 8,000 bytes per second) + the character's start in that part
  const BPS = 8000;
  const partStart = []; let accS = 0;
  for (const b of bufs) { partStart.push(accS); accS += b.length / BPS; }
  segStart = {};
  for (const m of (G.tts.marks || [])) {
    const al = aligns[m.chunk];
    if (!al || !al.character_start_times_seconds) continue;
    let pos = m.offset;
    const chars = al.characters || [];
    if (chars.slice(pos, pos + 8).join('') !== m.head.slice(0, 8)) { const j = chars.join('').indexOf(m.head); pos = j >= 0 ? j : -1; }
    if (pos >= 0 && pos < al.character_start_times_seconds.length) segStart[m.index] = Number((partStart[m.chunk] + al.character_start_times_seconds[pos]).toFixed(2));
  }
  const all = Buffer.concat(bufs);
  audioBin = await this.helpers.prepareBinaryData(all, 'briefing.mp3', 'audio/mpeg');
  audioB64 = all.toString('base64');
}

// ---- transcript with sources --------------------------------------------------------------
const claimById = Object.fromEntries(G.claims.map(c => [c.claim_id, c]));
const transcript = G.script.segments.map(s => ({
  index: s.index, kind: s.kind, story_id: s.story_id || null, text: s.display_text, claim_ids: s.claim_ids, t: segStart[s.index] != null ? segStart[s.index] : null,
  sources: s.claim_ids.map(id => { const c = claimById[id]; const a = arts[c.source_article_id] || {}; return { claim_id: id, publication: c.publication, headline: a.headline, url: c.source_url }; }),
}));

// ---- cost ----------------------------------------------------------------------------------
const CREDITS_PER_CHAR = { eleven_flash_v2_5: 0.5, eleven_turbo_v2_5: 0.5, eleven_multilingual_v2: 1, eleven_v4_turbo: 0.5 }; // v4 Turbo credit rate: VERIFY on your plan
const USD_PER_1K_CHARS = { eleven_v4_turbo: 0.04, eleven_flash_v2_5: 0.04 }; // API list price, VERIFY
const ttsChars = G.tts.enabled ? G.script.chars : 0;
const PRICE = { input: 0.25, cached: 0.025, output: 2.0 }; // gpt-5-mini per 1M tokens, VERIFY
const llmRows = [...(S.usage || []), ...(G.llm_usage || [])];
// USD per 1M tokens (OpenAI list prices, checked Nov 2026)
const PRICES = { 'gpt-6.2-sol': { input: 2.0, cached: 0.10, output: 10.0 }, 'gpt-6.1-terra': { input: 1.0, cached: 0.05, output: 5.0 }, 'gpt-5-mini': PRICE };
const priceFor = m => PRICES[Object.keys(PRICES).find(k => String(m || '').startsWith(k))] || PRICE;
const llmCost = r => { const p = priceFor(r.model); return ((r.input_tokens - (r.cached_input_tokens || 0)) * p.input + (r.cached_input_tokens || 0) * p.cached + r.output_tokens * p.output) / 1e6; };
const usage = {
  profile_parse: S.usage || [],
  writing: { calls: llmRows.map(r => r.stage), input_tokens: llmRows.reduce((a, r) => a + r.input_tokens, 0), output_tokens: llmRows.reduce((a, r) => a + r.output_tokens, 0), est_cost_usd: Number(llmRows.reduce((a, r) => a + llmCost(r), 0).toFixed(5)) },
  extraction: { new_articles: newRows.length, cached_articles: S.cached.length, input_tokens: newRows.reduce((a, r) => a + (r.input_tokens || 0), 0), output_tokens: newRows.reduce((a, r) => a + (r.output_tokens || 0), 0), est_cost_usd: Number(newRows.reduce((a, r) => a + (r.est_cost_usd || 0), 0).toFixed(5)) },
  tts: { model: G.tts.body.model_id, voice: G.tts.voice_name, billable_characters: ttsChars, est_credits: ttsChars * (CREDITS_PER_CHAR[G.tts.body.model_id] || 1), est_usd: USD_PER_1K_CHARS[G.tts.body.model_id] != null ? Number((ttsChars / 1000 * USD_PER_1K_CHARS[G.tts.body.model_id]).toFixed(4)) : null, script_characters: G.script.chars },
  elapsed_ms: Date.now() - S.started_at_ms,
};

// ---- HTML page ------------------------------------------------------------------------------
const li = arr => arr.map(x => `<li>${x}</li>`).join('');
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Briefing ${esc(S.plan.briefing_date)} – ${esc(P.profile_id)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1d1d1f;line-height:1.5}
h1{font-size:1.6rem;margin-bottom:.2rem}h2{margin-top:2.2rem;border-bottom:1px solid #ddd;padding-bottom:.3rem;font-size:1.2rem}
.muted{color:#666;font-size:.9rem}.seg{margin:.5rem 0;padding:.5rem .7rem;border-left:3px solid #ccc}.seg.claim{border-color:#2b6cb0;background:#f5f9ff}
.seg.explainer{border-color:#38a169;background:#f3fbf6}.src{font-size:.82rem;color:#2b6cb0}.tag{display:inline-block;font-size:.75rem;background:#eee;border-radius:4px;padding:0 .4rem;margin-right:.3rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{border-bottom:1px solid #eee;text-align:left;padding:.3rem .4rem;vertical-align:top}
.bad{color:#b83232}.card{border:1px solid #e3e3e3;border-radius:8px;padding:.7rem 1rem;margin:.6rem 0}audio{width:100%;margin:1rem 0}
</style></head><body>
<h1>Your briefing · ${esc(S.plan.briefing_date)}</h1>
<div class="muted">AI-generated voice (${esc(G.tts.voice_name)}) · script written automatically from the linked articles · news, not investment advice.</div>
${audioB64 ? `<audio controls src="data:audio/mpeg;base64,${audioB64}"></audio>` : '<p class="muted"><em>Text mode – audio was not generated (SYNTHESIZE_AUDIO is off).</em></p>'}
<p class="muted">≈ ${G.script.est_duration_seconds} s · ${G.script.words} words · profile ${esc(P.profile_id)}</p>

<h2>Transcript</h2>
${transcript.map(t => `<div class="seg ${t.kind}"><span class="tag">${t.kind}</span>${esc(t.text)}${t.sources.map(s => `<div class="src">Source: <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publication)} – ${esc(s.headline)}</a> <span class="muted">(${esc(s.claim_id)})</span></div>`).join('')}</div>`).join('\n')}

<h2>Why you got this briefing</h2>
<h3>1 · What we understood about you</h3>
${S.source_text ? `<p class="muted">You wrote: “${esc(S.source_text)}”</p>` : `<p class="muted">Preset: ${esc(S.preset)}</p>`}
<table><tr><th>Setting</th><th>Value</th></tr>
<tr><td>Topics</td><td>${esc(P.topics.join(', '))}</td></tr><tr><td>Companies / assets you follow</td><td>${esc(P.entities.join(', ') || '–')}</td></tr>
<tr><td>Region</td><td>${esc(P.region)}</td></tr><tr><td>Experience</td><td>${esc(P.expertise)}${P.explain_terms ? ' (terms get explained)' : ''}</td></tr>
<tr><td>Your question</td><td>${esc(P.listener_question || '–')} (focus: ${esc(P.focus)})</td></tr><tr><td>Length</td><td>${esc(P.duration_seconds)} s</td></tr><tr><td>Tone / pace / voice</td><td>${esc(P.tone)} / ${esc(P.pace)} / ${esc(G.tts.voice_name)} (speed ${esc(G.tts.body.voice_settings.speed)})</td></tr></table>
<p class="muted">Parsed by: ${esc(S.parser)}</p>
<ul>${li(S.profile_trace.map(t => `<b>${esc(t.field)}</b> → ${esc(t.value)} because ${esc(t.because)}`))}</ul>

<h3>2 · Stories chosen (${S.plan.selected.length} of ${S.plan.candidates} candidates, ${esc(P.duration_seconds)} s)</h3>
${S.plan.selected.map(s => `<div class="card"><b>#${s.rank} ${esc(s.title)}</b> <span class="muted">${esc(s.role || '')}</span><ul>${li((s.why || []).map(esc))}</ul></div>`).join('')}

<h3>2b · Editor decisions (what gets the airtime)</h3>
${G.plan ? `<div class="card"><div class="muted">Plan: ${esc(G.plan.mode)}</div>${G.plan.interpretation ? `<p><b>What you want:</b> ${esc(G.plan.interpretation)}</p>` : ''}<ul>${li(G.plan.stories.map(p => `<b>${esc(p.role)}</b> (${p.words} words, ${p.claims} facts): ${esc(p.angle)}`))}</ul>${(G.plan.changes || []).length ? `<p class="muted">Adjusted to the material:</p><ul>${li(G.plan.changes.map(esc))}</ul>` : ''}</div>` : '<p class="muted">–</p>'}

<h3>3 · Close, but not chosen</h3>
<ul>${li(S.plan.runners_up.map(r => `${esc(r.title)} <span class="muted">– ${esc(r.why_not)}</span>`)) || '<li>–</li>'}</ul>

<h3>4 · Filtered out before ranking</h3>
<ul>${li(Object.entries(S.plan.excluded).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} × ${esc(k)}`))}</ul>

<h3>5 · Fact checks behind every sentence</h3>
${G.story_claims.map(sc => `<div class="card"><b>${esc(sc.title)}</b><div class="muted">${sc.used_claim_ids.length} claims used · ${sc.available_verified} passed all checks · ${sc.rejected.length} rejected</div>${sc.rejected.length ? `<ul>${li(sc.rejected.map(r => `<span class="bad">rejected:</span> ${esc(r.statement)} <span class="muted">(${esc(r.errors.join(', '))})</span>`))}</ul>` : ''}</div>`).join('')}
<div class="card"><b>Script check</b><div class="muted">Script: ${esc(G.script_checks.mode === 'llm_writer' ? 'written by the model from verified claims only' : 'template (claims read one by one)')}${G.script_checks.writer_error ? ' – writer failed: ' + esc(G.script_checks.writer_error) : ''} · fact check: ${esc(G.script_checks.verifier)}</div>${G.script_checks.dropped.length ? `<ul>${li(G.script_checks.dropped.map(d => `<span class="bad">removed (${esc(d.by)}):</span> ${esc(d.text)} <span class="muted">– ${esc(d.why)}</span>`))}</ul>` : '<p class="muted">No sentence had to be removed.</p>'}</div>
${G.dropped_stories.length ? `<p class="bad">Dropped because no claim passed the checks: ${esc(G.dropped_stories.map(d => d.title + ' – ' + d.why).join('; '))}</p>` : ''}
${G.trimmed_for_time.length ? `<p class="muted">${G.trimmed_for_time.length} extra claim(s) cut to fit the time budget.</p>` : ''}

<h2>Cost of this briefing</h2>
<table><tr><td>Claim extraction</td><td>${usage.extraction.new_articles} new article(s), ${usage.extraction.cached_articles} from cache · ${usage.extraction.input_tokens} in / ${usage.extraction.output_tokens} out tokens · ≈ $${usage.extraction.est_cost_usd}</td></tr>
<tr><td>Profile, script writing &amp; fact check</td><td>${esc(usage.writing.calls.join(', ') || '–')} · ${usage.writing.input_tokens} in / ${usage.writing.output_tokens} out tokens · ≈ $${usage.writing.est_cost_usd}</td></tr>
<tr><td>Text-to-speech</td><td>${usage.tts.billable_characters} characters · ≈ ${usage.tts.est_credits} credits${usage.tts.est_usd != null ? ' ≈ $' + usage.tts.est_usd : ''} (${esc(usage.tts.model)})</td></tr>
<tr><td>Run time</td><td>${(usage.elapsed_ms / 1000).toFixed(1)} s</td></tr></table>
<p class="muted">Run ${esc(G.run_id)} · grouping and number checks are rules-based; models parse your profile, extract claims, write the script from verified claims and fact-check it.</p>
</body></html>`;

const pageBin = await this.helpers.prepareBinaryData(Buffer.from(html, 'utf8'), `briefing_${P.profile_id}.html`, 'text/html');
const binary = { briefing_page: pageBin };
if (audioBin) { audioBin.fileName = `briefing_${P.profile_id}.mp3`; binary.audio = audioBin; }

return [{ json: {
  run_id: G.run_id,
  profile: P, profile_trace: S.profile_trace,
  decisions: { selected: S.plan.selected.map(s => ({ story_id: s.story_id, rank: s.rank, title: s.title, role: s.role, score: s.score, why: s.why })), runners_up: S.plan.runners_up.map(r => ({ title: r.title, score: r.score, why_not: r.why_not })), excluded: S.plan.excluded, dropped_stories: G.dropped_stories },
  transcript, usage,
  planner: S.planner || null, plan: G.plan || null, script_checks: G.script_checks || null, story_claims: G.story_claims || [], audio_available: !!audioBin,
  disclosure: 'Narrated by an AI-generated voice. Script generated automatically from the linked articles.',
}, binary }];
