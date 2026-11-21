// ============================================================================
// WORKFLOW D — NODE: "Select stories" (named like B's node so the shared extraction code runs unchanged)
// Picks the next batch of articles from the whole week that have no cached facts yet.
// Translations, roundups and exact copies are skipped (their original is extracted).
// Query: ?limit=150&from=2026-11-13
// ============================================================================
const PROMPT_VERSION = 'extract-v4';
const q = $('Run pre-extraction').first().json.query || {};
const LIMIT = Math.max(1, Math.min(300, Number(q.limit) || 150));
const FROM = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? q.from : '2026-11-13';
const arts = $('Get articles').all().map(i => i.json).filter(a => a.article_id && a.text_content);
const cached = new Set($('Get claim cache').all().map(i => i.json).filter(r => r.article_id && r.prompt_version === PROMPT_VERSION).map(r => r.article_id + '|' + r.content_hash));
const todo = arts.filter(a => String(a.published_at) >= FROM && !['translation', 'roundup'].includes(a.role) && !a.copy_of && !cached.has(a.article_id + '|' + a.content_hash))
  .sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)));
const batch = todo.slice(0, LIMIT);
return [{ json: { prompt_version: PROMPT_VERSION, to_extract: batch.map(a => ({ story_id: a.story_id, article_id: a.article_id })), cached: [], remaining_after_this_batch: todo.length - batch.length, total_uncached: todo.length } }];
