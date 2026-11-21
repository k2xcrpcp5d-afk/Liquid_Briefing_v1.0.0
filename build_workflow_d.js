// Builds Workflow D: pre-extract facts for the whole week (all unique articles) into lb_claims.
// Same extraction prompt + validation as B. Trigger: GET /webhook/lb-preextract?limit=150&from=2026-11-13
// usage: node build_workflow_d.js [local|instance]
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const local = process.argv[2] === 'local';
const instance = process.argv[2] === 'instance';
const C = f => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');
const region = (file, start, end) => { const s = C(file); const a = s.indexOf(start), b = s.indexOf(end); return s.slice(s.indexOf('\n', a) + 1, b); };
const code23 = C('23_extraction_requests.tmpl.js').replace('/*__EXTRACT_PROMPT__*/', region('01_prepare.js', '// <<EXTRACT_PROMPT', '// EXTRACT_PROMPT>>'));
const code24 = C('24_validate_batch.tmpl.js').replace('/*__VALIDATE_CORE__*/', region('03_validate_claims.js', '// <<VALIDATE_CORE', '// VALIDATE_CORE>>'));
const id = () => randomUUID();
const dt = name => ({ __rl: true, mode: 'name', value: name });
const ifNode = (name, expr, pos) => ({ name, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: id(), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });
const OPENAI_URL = local ? 'http://127.0.0.1:8789/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
const CLAIM_COLS = [['article_id', 'string'], ['story_id', 'string'], ['content_hash', 'string'], ['prompt_version', 'string'], ['model', 'string'], ['extraction_error', 'string'],
  ['summary', 'string'], ['claims_json', 'string'], ['verified_count', 'number'], ['rejected_count', 'number'], ['input_tokens', 'number'], ['cached_input_tokens', 'number'], ['output_tokens', 'number'],
  ['est_cost_usd', 'number'], ['created_at', 'string']];
const getAll = (name, table, pos, extra = {}) => ({ name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, executeOnce: true, ...extra, parameters: { resource: 'row', operation: 'get', dataTableId: dt(table), returnAll: true } });
const nodes = [
  { name: 'Run pre-extraction', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300], webhookId: id(), parameters: { httpMethod: 'GET', path: local ? 'lb-preextract-local' : 'lb-preextract', responseMode: 'responseNode', options: {} } },
  { name: 'Started', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [220, 300], parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ started: true, execution: $execution.id }) }}', options: {} } },
  { name: 'Create lb_claims', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [440, 300], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'lb_claims', columns: { column: CLAIM_COLS.map(([name, type]) => ({ name, type })) }, options: { createIfNotExists: true } } },
  getAll('Get articles', 'lb_articles', [660, 300]),
  getAll('Get claim cache', 'lb_claims', [880, 300], { alwaysOutputData: true }),
  { name: 'Select stories', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 300], parameters: { jsCode: C('32_pick_preextract.js') } },
  { name: 'Build extraction requests', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 300], parameters: { jsCode: code23 } },
  ifNode('Anything to extract?', '={{ $json.skip !== true }}', [1540, 300]),
  { name: 'OpenAI extract claims', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1760, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    parameters: { method: 'POST', url: OPENAI_URL, authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.openai_body) }}', options: { timeout: 180000, batching: { batch: { batchSize: 20, batchInterval: 500 } } } } },
  { name: 'Validate claims (batch)', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1980, 300], parameters: { jsCode: code24 } },
  { name: 'Insert lb_claims', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [2200, 300],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_claims'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { optimizeBulk: true } } },
  { name: 'README', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, 0], parameters: { width: 900, height: 200,
    content: '## Workflow D - pre-extract the whole week\nExtracts verified facts (+ one-line summary) for every unique article from `from` on that is not cached yet, `limit` per run. Publish, then call `GET /webhook/lb-preextract?limit=150` until the planner sees all articles. Re-running is safe: cached articles are skipped.' } },
];
nodes.forEach(n => { n.id = id(); });
if (instance) for (const n of nodes) if (n.type === 'n8n-nodes-base.httpRequest') n.credentials = { openAiApi: { id: 'BzyXxdtqGGj4qBP3', name: 'OpenAI account' } };
const link = (...t) => ({ main: t.map(x => (x === null ? [] : [{ node: x, type: 'main', index: 0 }])) });
const connections = {
  'Run pre-extraction': link('Started'), 'Started': link('Create lb_claims'), 'Create lb_claims': link('Get articles'), 'Get articles': link('Get claim cache'),
  'Get claim cache': link('Select stories'), 'Select stories': link('Build extraction requests'), 'Build extraction requests': link('Anything to extract?'),
  'Anything to extract?': link('OpenAI extract claims'), 'OpenAI extract claims': link('Validate claims (batch)'), 'Validate claims (batch)': link('Insert lb_claims'),
};
const wf = { name: 'Liquid Briefing - D pre-extract week' + (local ? ' (local test)' : ''), nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
const out = path.join(__dirname, 'out', local ? 'wf_d_local.json' : instance ? 'liquid-briefing-D-preextract.TEAM-INSTANCE.workflow.json' : 'liquid-briefing-D-preextract.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, nodes.length, 'nodes');
