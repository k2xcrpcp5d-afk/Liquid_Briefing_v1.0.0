// ============================================================================
// NODE: "Package briefing"   (Code node, Run Once for All Items)
// Joins gate metadata with the MP3 (if synthesized). Produces the player
// payload: transcript segments with claim IDs + publisher links, and the usage log.
// Listener-facing payload contains NO source passages (licensing).
// ============================================================================
const prep = $('Prepare article & request').first().json;
const CONFIG = prep.config;
const article = prep.article;
const g = $('Build script & gate').first().json;   // metadata survives the binary-only TTS response
const inItem = $input.first();

// ---- audio ------------------------------------------------------------------
let binary = undefined;
let audio = { synthesized: false };
if (g.tts.enabled) {
  const bin = inItem.binary && inItem.binary.audio;
  if (!bin) throw new Error('ElevenLabs returned no binary "audio" - check HTTP node Response Format = File, output field = audio');
  bin.fileName = `briefing_${g.run_id}.mp3`;
  bin.mimeType = bin.mimeType || 'audio/mpeg';
  binary = { audio: bin };
  audio = { synthesized: true, file_name: bin.fileName, mime_type: bin.mimeType, file_size: bin.fileSize || null };
}

// ---- transcript (same validated segments that were spoken) ------------------
const byId = Object.fromEntries(g.claims.map(c => [c.claim_id, c]));
const transcript = g.script.segments.map(s => ({
  index: s.index,
  kind: s.kind,
  text: s.display_text,
  claim_ids: s.claim_ids,
  sources: s.claim_ids.map(id => ({
    claim_id: id,
    publication: byId[id].publication,
    headline: article.headline,
    url: byId[id].source_url,
  })),
}));

// ---- usage / cost -------------------------------------------------------------
const ttsChars = g.tts.enabled ? g.script.chars : 0;
const el = CONFIG.PRICES.elevenlabs;
const cpc = el.credits_per_char[CONFIG.ELEVENLABS_MODEL_ID];
const credits = cpc != null ? ttsChars * cpc : null;
const usage_log = [
  ...g.usage_log,
  {
    run_id: g.run_id,
    stage: 'tts',
    model: CONFIG.ELEVENLABS_MODEL_ID,
    billable_characters: ttsChars,
    est_credits: credits,
    est_cost_usd: credits != null && el.usd_per_1k_credits != null ? Number((credits / 1000 * el.usd_per_1k_credits).toFixed(6)) : null,
    cache_hit: false,
    logged_at: new Date().toISOString(),
  },
];
const llmUsd = usage_log.filter(r => r.stage !== 'tts').reduce((a, r) => a + (r.est_cost_usd || 0), 0);

return [{
  json: {
    run_id: g.run_id,
    briefing: {
      profile_id: g.profile.id,
      briefing_date: CONFIG.BRIEFING_DATE,
      disclosure: 'Narrated by an AI-generated voice. Script generated automatically from the linked articles.',
      est_duration_seconds: g.script.est_duration_seconds,
      audio,
      transcript,
    },
    claims_public: g.claims.map(c => ({
      claim_id: c.claim_id, statement: c.statement, status: c.status,
      source_url: c.source_url, publication: c.publication,
    })),
    debug_internal: { // team only - do not render in the player
      story: g.story,
      claim_checks: g.claims.map(c => ({ claim_id: c.claim_id, local_id: c.local_id, status: c.status, errors: c.errors, warnings: c.warnings, evidence: c.internal })),
      gate: g.gate,
      tts_text: g.script.tts_text,
    },
    usage: {
      rows: usage_log,
      totals: {
        llm_input_tokens: usage_log.reduce((a, r) => a + (r.input_tokens || 0), 0),
        llm_output_tokens: usage_log.reduce((a, r) => a + (r.output_tokens || 0), 0),
        llm_est_cost_usd: Number(llmUsd.toFixed(6)),
        tts_billable_characters: ttsChars,
        tts_est_credits: credits,
        elapsed_ms: Date.now() - prep.started_at_ms,
      },
    },
  },
  ...(binary ? { binary } : {}),
}];
