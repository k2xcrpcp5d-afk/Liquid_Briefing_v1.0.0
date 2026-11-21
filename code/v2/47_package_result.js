// ============================================================================
// WORKFLOW B v2 — NODE: "Package result"   (Code node, Run Once for All Items)
// Joins the recorded parts, turns ElevenLabs timestamps into segment start times and
// builds the result the website shows: transcript with a source link per fact, notes, cost.
// ============================================================================
const F = $('Finalize profile').first().json;
const P = F.profile;
const V = $('Verify facts').first().json;
const G = $('Build script & gate').first().json;
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
  sources: s.claim_ids.map(id => { const c = claimById[id]; return { claim_id: id, publication: c.publication, headline: c.statement, url: c.source_url, date: c.date }; }),
}));
// ---- cost (list prices per 1M tokens; web search per call) - VERIFY against your invoices
const PRICES = { 'gpt-6.2-sol': { input: 2.0, cached: 0.10, output: 10.0 }, 'gpt-6.1-terra': { input: 1.0, cached: 0.05, output: 5.0 }, 'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.0 } };
const WEB_SEARCH_USD = 0.01; // per search call, VERIFY
const priceFor = m => PRICES[Object.keys(PRICES).find(k => String(m || '').startsWith(k))] || PRICES['gpt-6.1-terra'];
const llmCost = r => { const p = priceFor(r.model); return ((r.input_tokens - (r.cached_input_tokens || 0)) * p.input + (r.cached_input_tokens || 0) * p.cached + r.output_tokens * p.output) / 1e6 + (r.web_searches || 0) * WEB_SEARCH_USD; };
const rows = G.llm_usage || [];
const ttsChars = G.tts.enabled ? G.script.chars : 0;
const usage = {
  llm: { calls: rows.map(r => r.stage), input_tokens: rows.reduce((a, r) => a + r.input_tokens, 0), output_tokens: rows.reduce((a, r) => a + r.output_tokens, 0), web_searches: rows.reduce((a, r) => a + (r.web_searches || 0), 0), est_cost_usd: Number(rows.reduce((a, r) => a + llmCost(r), 0).toFixed(4)) },
  tts: { model: G.tts.body.model_id, voice: G.tts.voice_name, billable_characters: ttsChars, est_usd: Number((ttsChars / 1000 * 0.04).toFixed(4)) },
  elapsed_ms: Date.now() - F.started_at_ms,
};
const result = {
  run_id: F.run_id, version: 'v2_web',
  profile: P, profile_trace: F.profile_trace,
  planner: { interpretation: null, better_character: null, short_reason: V.answerable === false ? (V.notes || []).join(' ') || null : null },
  script_checks: G.script_checks,
  check: V.check, rejected_facts: V.rejected.slice(0, 40),
  transcript, usage, audio_available: !!audioB64,
  disclosure: 'Narrated by an AI-generated voice. Script written automatically from the linked articles; every fact was checked against its source page.',
};
return [{ json: result, ...(audioBin ? { binary: { audio: audioBin } } : {}) }];
