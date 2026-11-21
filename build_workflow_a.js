// Builds Workflow A (ingest + group) as importable n8n JSON.
// usage: node build_workflow_a.js [local]   (local = Manual Trigger + Read Files from Disk instead of Form upload)
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const local = process.argv[2] === 'local';
const code = f => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');
const id = () => randomUUID();
const dt = (name) => ({ __rl: true, mode: 'name', value: name });

const STORY_COLS = [['story_id', 'string'], ['kind', 'string'], ['title', 'string'], ['first_seen', 'string'], ['last_seen', 'string'], ['outlets', 'string'],
  ['independent_outlet_count', 'number'], ['article_count', 'number'], ['article_ids', 'string'], ['translation_ids', 'string'], ['representative_article_id', 'string'],
  ['entities', 'string'], ['provider_categories', 'string'], ['phase', 'string'], ['editorial_score', 'number'], ['storyline_id', 'string'],
  ['check_status', 'string'], ['check_label', 'string'], ['split_from', 'string']];
const ARTICLE_COLS = [['article_id', 'string'], ['story_id', 'string'], ['role', 'string'], ['feed', 'string'], ['publication', 'string'], ['permalink', 'string'],
  ['language', 'string'], ['published_at', 'string'], ['headline', 'string'], ['excerpt', 'string'], ['author', 'string'], ['provider_categories', 'string'],
  ['content_hash', 'string'], ['translation_of', 'string'], ['copy_of', 'string'], ['text_len', 'number'], ['text_content', 'string']];
const cols = list => ({ column: list.map(([name, type]) => ({ name, type })) });

const trigger = local
  ? [{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-220, 300], parameters: {} },
     { name: 'Read JSONL from disk', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: [0, 300], parameters: { operation: 'read', fileSelector: './data/*.jsonl', options: {} } }]
  : [{ name: 'Upload JSONL files', type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2, position: [0, 300], webhookId: id(),
       parameters: { formTitle: 'Liquid Briefing - load Newstex snapshot', formDescription: 'Upload all six .jsonl files at once. Existing rows in lb_stories / lb_articles are replaced.',
         formFields: { values: [{ fieldLabel: 'jsonl_files', fieldType: 'file', multipleFiles: true, acceptFileTypes: '.jsonl', requiredField: true }] }, options: {} } }];
const triggerName = trigger[trigger.length - 1].name;

const nodes = [
  ...trigger,
  { name: 'Parse JSONL', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300], parameters: { jsCode: code('09_parse_jsonl.js') } },
  { name: 'Normalize, link & group', type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 300], parameters: { jsCode: code('10_ingest_group.js') } },
  { name: 'Prepare cluster checks', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 300], parameters: { jsCode: code('11_prepare_cluster_checks.js') } },
  { name: 'LLM check skipped?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [880, 300],
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: id(), leftValue: '={{ $json.skip === true }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
  { name: 'OpenAI cluster check', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1100, 420], retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    parameters: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.openai_body) }}',
      options: { timeout: 120000, batching: { batch: { batchSize: 5, batchInterval: 1000 } } } } },
  { name: 'Apply checks & build rows', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 300], parameters: { jsCode: code('13_apply_checks_and_rows.js') } },
  { name: 'Create lb_stories', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1540, 300], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'lb_stories', columns: cols(STORY_COLS), options: { createIfNotExists: true } } },
  { name: 'Create lb_articles', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1760, 300], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'lb_articles', columns: cols(ARTICLE_COLS), options: { createIfNotExists: true } } },
  { name: 'Clear lb_stories', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1980, 300], executeOnce: true,
    parameters: { resource: 'table', operation: 'clear', dataTableId: dt('lb_stories') } },
  { name: 'Clear lb_articles', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [2200, 300], executeOnce: true,
    parameters: { resource: 'table', operation: 'clear', dataTableId: dt('lb_articles') } },
  { name: 'Story rows', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2420, 300],
    parameters: { jsCode: "return $('Apply checks & build rows').all().filter(i => i.json._type === 'story_row').map(i => { const { _type, ...row } = i.json; return { json: row }; });" } },
  { name: 'Insert lb_stories', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [2640, 300],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_stories'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { optimizeBulk: true } } },
  { name: 'Article rows', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2860, 300],
    parameters: { jsCode: "return $('Apply checks & build rows').all().filter(i => i.json._type === 'article_row').map(i => { const { _type, ...row } = i.json; return { json: row }; });" } },
  { name: 'Insert lb_articles', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [3080, 300],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_articles'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { optimizeBulk: true } } },
  { name: 'Run report', type: 'n8n-nodes-base.code', typeVersion: 2, position: [3300, 300],
    parameters: { jsCode: "const r = $('Apply checks & build rows').all().find(i => i.json._type === 'report').json;\nreturn [{ json: { ...r, inserted: { stories: $('Insert lb_stories').all().map(i => i.json), articles: $('Insert lb_articles').all().map(i => i.json) } } }];" } },
  { name: 'README', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -40], parameters: { width: 1300, height: 230,
    content: '## Workflow A - load & group the Newstex snapshot (no LLM by default)\n1. Open the form URL (Form Trigger -> Production/Test URL) and upload all six .jsonl files at once.\n2. Rules only: normalize, exact copies, DE/NL translations (same author, nearest EN within 15 min), roundups, TF-IDF + named-entity + event-type grouping, average-link with 36 h span cap.\n3. Optional escalation: set `USE_LLM_CLUSTER_CHECK: true` in *Prepare cluster checks* and select the OpenAI credential. A small model may only SPLIT clusters (about 40 calls, cents).\n4. Results replace the rows in Data Tables `lb_stories` and `lb_articles` (created automatically). *Run report* shows counts and cost.\nWorkflow setting "binary mode" must stay **separate**.' } },
];
nodes.forEach(n => { n.id = id(); });

const link = (...t) => ({ main: t.map(x => (x === null ? [] : [{ node: x, type: 'main', index: 0 }])) });
const connections = {
  ...(local ? { 'Manual Trigger': link('Read JSONL from disk') } : {}),
  [triggerName]: link('Parse JSONL'),
  'Parse JSONL': link('Normalize, link & group'),
  'Normalize, link & group': link('Prepare cluster checks'),
  'Prepare cluster checks': link('LLM check skipped?'),
  'LLM check skipped?': link('Apply checks & build rows', 'OpenAI cluster check'),
  'OpenAI cluster check': link('Apply checks & build rows'),
  'Apply checks & build rows': link('Create lb_stories'),
  'Create lb_stories': link('Create lb_articles'),
  'Create lb_articles': link('Clear lb_stories'),
  'Clear lb_stories': link('Clear lb_articles'),
  'Clear lb_articles': link('Story rows'),
  'Story rows': link('Insert lb_stories'),
  'Insert lb_stories': link('Article rows'),
  'Article rows': link('Insert lb_articles'),
  'Insert lb_articles': link('Run report'),
};
const wf = { name: 'Liquid Briefing - A ingest & group' + (local ? ' (local test)' : ''), nodes, connections, settings: { executionOrder: 'v1', binaryMode: 'separate' }, pinData: {} };
const out = path.join(__dirname, 'out', local ? 'wf_a_local.json' : 'liquid-briefing-A-ingest-group.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, nodes.length, 'nodes');
