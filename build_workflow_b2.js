// Builds Workflow B v2 (web research edition) as importable n8n JSON.
// News comes from live web search on trusted outlets; every fact is checked against its source page
// before the host may say it. usage: node build_workflow_b2.js [local|instance]
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const local = process.argv[2] === 'local';
const instance = process.argv[2] === 'instance';
const C = f => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');
const region = (file, start, end) => { const s = C(file); const a = s.indexOf(start), b = s.indexOf(end); if (a < 0 || b < 0) throw new Error(`marker missing in ${file}`); return s.slice(s.indexOf('\n', a) + 1, b); };
const GATE = region('04_script_and_gate.js', '// <<GATE_HELPERS', '// GATE_HELPERS>>');
let code46 = C('v2/46_build_script.tmpl.js').replace('/*__GATE_HELPERS__*/', GATE);
if (instance || local) code46 = code46.replace('SYNTHESIZE_AUDIO: false,', 'SYNTHESIZE_AUDIO: true,');
fs.writeFileSync(path.join(__dirname, 'code', 'v2', '46_build_script.built.js'), code46);
let code40 = C('v2/40_research_plan.js');
if (local) code40 = code40.replace('LOCAL: false /*__LOCAL__*/', 'LOCAL: true');

const id = () => randomUUID();
const dt = name => ({ __rl: true, mode: 'name', value: name });
const ifNode = (name, expr, pos) => ({ name, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: id(), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });
const BASE = local ? 'http://127.0.0.1:8789' : 'https://api.openai.com';
const EL_BASE = local ? 'http://127.0.0.1:8789' : 'https://api.elevenlabs.io';
const openaiHttp = (name, pos, url = '/v1/chat/completions', timeout = 240000) => ({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
  parameters: { method: 'POST', url: BASE + url, authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, specifyBody: 'json',
    jsonBody: url === '/v1/responses' ? '={{ JSON.stringify($json.body) }}' : '={{ JSON.stringify($json.openai_body) }}', options: { timeout } } });
const code = (name, file, pos, extra = {}) => ({ name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, ...extra, parameters: { jsCode: file } });

const nodes = [
  code('Build profile', C('20_build_profile.js'), [220, 300]),
  ifNode('Parse with LLM?', '={{ $json.use_llm === true }}', [440, 300]),
  openaiHttp('OpenAI profile parser', [660, 180], '/v1/chat/completions', 120000),
  code('Finalize profile', C('21_finalize_profile.js'), [880, 300]),
  code('Plan research', code40, [1100, 300]),
  openaiHttp('OpenAI research', [1320, 300], '/v1/responses', 300000),
  code('Collect sources', C('v2/41_collect_sources.js'), [1540, 300]),
  { name: 'Fetch source', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1760, 300], onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: '={{ $json.url }}', sendHeaders: true, headerParameters: { parameters: [
      { name: 'User-Agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36' },
      { name: 'Accept-Language', value: 'en,de;q=0.9,nl;q=0.8' }] },
      options: { timeout: 20000, response: { response: { responseFormat: 'text', outputPropertyName: 'html' } } } } },
  code('Verify facts', C('v2/42_verify_facts.js'), [1980, 300]),
  code('Writer request', C('v2/43_writer_request.js'), [2200, 300]),
  openaiHttp('OpenAI writer', [2420, 300]),
  code('Check length', C('v2/44_check_length.js'), [2640, 300]),
  ifNode('Too short?', '={{ $json.needs_expand === true }}', [2860, 300]),
  openaiHttp('OpenAI expand', [3080, 180]),
  code('Merge additions', C('v2/45_merge_additions.js'), [3300, 300]),
  code('Build script & gate', code46, [3520, 300]),
  ifNode('Synthesize audio?', '={{ $json.tts.enabled === true }}', [3740, 300]),
  { name: 'ElevenLabs TTS', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [3960, 180], retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    parameters: { method: 'POST', url: `=${EL_BASE}/v1/text-to-speech/{{ $json.tts.voice_id }}/with-timestamps?output_format={{ $json.tts.output_format }}`,
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.tts.body) }}', options: { timeout: 180000 } } },
  code('Package result', C('v2/47_package_result.js'), [4180, 300]),
  { name: 'Website start', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 620], webhookId: id(),
    parameters: { httpMethod: 'GET', path: local ? 'lb-start-local' : 'lb-start', responseMode: 'responseNode', options: {} } },
  { name: 'Accept job', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 620],
    parameters: { jsCode: "const q = $input.first().json.query || {};\nreturn [{ json: { job_id: String($execution.id), 'About you': String(q.about || '').slice(0, 1500), 'Preset': String(q.preset || 'custom (use my text)'), 'Length': String(q.length || 'auto'), 'Profile JSON': String(q.profile || '').slice(0, 4000), received_at: new Date().toISOString() } }];" } },
  { name: 'Respond: job accepted', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [440, 620],
    parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ job_id: $json.job_id }) }}', options: { responseHeaders: { entries: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'no-store' }] } } } },
  { name: 'Create lb_jobs', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [660, 620], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'lb_jobs', columns: { column: [['job_id', 'string'], ['status', 'string'], ['created_at', 'string'], ['input_json', 'string'], ['result_json', 'string'], ['error', 'string']].map(([name, type]) => ({ name, type })) }, options: { createIfNotExists: true } } },
  { name: 'Create lb_audio', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [880, 620], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'lb_audio', columns: { column: [['job_id', 'string'], ['audio_b64', 'string']].map(([name, type]) => ({ name, type })) }, options: { createIfNotExists: true } } },
  { name: 'Job row: running', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 620],
    parameters: { jsCode: "const j = $('Accept job').first().json;\nreturn [{ json: { job_id: j.job_id, status: 'running', created_at: new Date().toISOString(), input_json: JSON.stringify({ about: j['About you'], preset: j['Preset'], length: j['Length'], profile: j['Profile JSON'] || null }), result_json: JSON.stringify({ stage: 'start', progress: 0.04, label: 'Reading your profile' }), error: null } }];" } },
  { name: 'Insert job (running)', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1320, 620],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_jobs'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  { name: 'Audio row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [6600, 180],
    parameters: { jsCode: "const job = $('Accept job').first().json.job_id;\nconst it = $input.first();\nlet audio_b64 = null;\nif (it.binary && it.binary.audio) audio_b64 = (await this.helpers.getBinaryDataBuffer(0, 'audio')).toString('base64');\nreturn [{ json: { job_id: job, audio_b64 } }];" } },
  { name: 'Insert audio', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [6820, 180],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_audio'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  { name: 'Trim old audio', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [6820, 0], alwaysOutputData: true, onError: 'continueRegularOutput',
    parameters: { resource: 'row', operation: 'deleteRows', dataTableId: dt('lb_audio'), matchType: 'allConditions', filters: { conditions: [{ keyName: 'id', condition: 'lt', keyValue: '={{ $json.id - 6 }}' }] }, options: {} } },
  { name: 'Job row: done', type: 'n8n-nodes-base.code', typeVersion: 2, position: [7040, 180],
    parameters: { jsCode: "const job = $('Accept job').first().json.job_id;\nconst r = $('Package result').first().json;\nreturn [{ json: { job_id: job, status: 'done', created_at: new Date().toISOString(), input_json: null, result_json: JSON.stringify(r), error: null } }];" } },
  { name: 'Insert job (done)', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [7260, 180],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_jobs'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  { name: 'Trim old jobs', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [7480, 180], alwaysOutputData: true, onError: 'continueRegularOutput',
    parameters: { resource: 'row', operation: 'deleteRows', dataTableId: dt('lb_jobs'), matchType: 'allConditions', filters: { conditions: [{ keyName: 'id', condition: 'lt', keyValue: '={{ $json.id - 400 }}' }] }, options: {} } },
  { name: 'On error', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 860], parameters: {} },
  { name: 'Job row: error', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 860],
    parameters: { jsCode: "const e = $input.first().json;\nconst msg = String((e.execution && e.execution.error && e.execution.error.message) || 'Workflow failed').split('\\nREPORT')[0].slice(0, 600);\nreturn [{ json: { job_id: String(e.execution && e.execution.id), status: 'error', created_at: new Date().toISOString(), input_json: null, result_json: null, error: msg } }];" } },
  { name: 'Insert job (error)', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [440, 860],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_jobs'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  { name: 'README', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -80], parameters: { width: 1500, height: 240,
    content: '## Workflow B v2 - one personal episode per listener, researched live\n1. *Plan research* turns the request, length and host into 1-3 research briefs. 2. *OpenAI research* searches the web, only on trusted outlets that we can read back. 3. *Fetch source* + *Verify facts* read every source page: the quote must be on the page and every number too, or the fact is dropped. 4. *Writer request* - the host tells it as one story at the chosen length; *Check length* adds more context if it is short. 5. *Build script & gate* drops any segment with a number or fact without a verified source, or anything that sounds like investment advice. 6. ElevenLabs with timestamps, *Package result* -> lb_jobs / lb_audio for the website.' } },
];
// positions of the frame nodes (website entry below the main line, exit on the right)
const pos = { 'Website start': [0, 620], 'Accept job': [220, 620], 'Respond: job accepted': [440, 620], 'Create lb_jobs': [660, 620], 'Create lb_audio': [880, 620], 'Job row: running': [1100, 620], 'Insert job (running)': [1320, 620],
  'Audio row': [4400, 180], 'Insert audio': [4620, 180], 'Trim old audio': [4840, 180], 'Job row: done': [5060, 180], 'Insert job (done)': [5280, 180], 'Trim old jobs': [5500, 180], 'On error': [0, 860], 'Job row: error': [220, 860], 'Insert job (error)': [440, 860] };
nodes.forEach(n => { n.id = id(); if (pos[n.name]) n.position = pos[n.name]; });
if (instance) for (const n of nodes) {
  if (n.type !== 'n8n-nodes-base.httpRequest' || n.name === 'Fetch source') continue;
  n.credentials = n.name === 'ElevenLabs TTS' ? { httpHeaderAuth: { id: '7EyLg69Fv7XWRaYe', name: 'Header Auth account' } } : { openAiApi: { id: 'BzyXxdtqGGj4qBP3', name: 'OpenAI account' } };
}
const link = (...t) => ({ main: t.map(x => (x === null ? [] : [{ node: x, type: 'main', index: 0 }])) });
const connections = {
  'Website start': link('Accept job'), 'Accept job': link('Respond: job accepted'), 'Respond: job accepted': link('Create lb_jobs'), 'Create lb_jobs': link('Create lb_audio'),
  'Create lb_audio': link('Job row: running'), 'Job row: running': link('Insert job (running)'), 'Insert job (running)': link('Build profile'),
  'Build profile': link('Parse with LLM?'), 'Parse with LLM?': link('OpenAI profile parser', 'Finalize profile'), 'OpenAI profile parser': link('Finalize profile'),
  'Finalize profile': link('Plan research'), 'Plan research': link('OpenAI research'), 'OpenAI research': link('Collect sources'), 'Collect sources': link('Fetch source'),
  'Fetch source': link('Verify facts'), 'Verify facts': link('Writer request'), 'Writer request': link('OpenAI writer'), 'OpenAI writer': link('Check length'),
  'Check length': link('Too short?'), 'Too short?': link('OpenAI expand', 'Merge additions'), 'OpenAI expand': link('Merge additions'),
  'Merge additions': link('Build script & gate'), 'Build script & gate': link('Synthesize audio?'), 'Synthesize audio?': link('ElevenLabs TTS', 'Package result'),
  'ElevenLabs TTS': link('Package result'), 'Package result': link('Audio row'), 'Audio row': link('Insert audio'), 'Insert audio': link('Trim old audio'),
  'Trim old audio': link('Job row: done'), 'Job row: done': link('Insert job (done)'), 'Insert job (done)': link('Trim old jobs'),
  'On error': link('Job row: error'), 'Job row: error': link('Insert job (error)'),
};
// real progress for the website (side branches above the main line run first, execution order v1)
const STAGES = [
  ['Plan research', 'planning', 0.08, 'Planning your episode'],
  ['Collect sources', 'reading', 0.4, 'Reading the sources'],
  ['Verify facts', 'checking', 0.52, 'Checking every fact against its source'],
  ['Check length', 'writing', 0.7, 'Writing the script'],
  ['Build script & gate', 'recording', 0.85, 'Recording the audio'],
];
for (const [parent, stage, progress, label] of STAGES) {
  const par = nodes.find(n => n.name === parent);
  const [x, y] = par.position;
  const cName = `Progress: ${stage}`, iName = `Save progress: ${stage}`;
  nodes.push({ id: id(), name: cName, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 120, y - 300], onError: 'continueRegularOutput', executeOnce: true,
    parameters: { jsCode: `let job = null;\ntry { job = $('Accept job').first().json.job_id; } catch (e) { return []; }\nreturn [{ json: { job_id: job, status: 'running', created_at: new Date().toISOString(), input_json: null, result_json: JSON.stringify({ stage: ${JSON.stringify(stage)}, progress: ${progress}, label: ${JSON.stringify(label)} }), error: null } }];` } });
  nodes.push({ id: id(), name: iName, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [x + 340, y - 300], onError: 'continueRegularOutput',
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_jobs'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } });
  connections[parent].main[0].push({ node: cName, type: 'main', index: 0 });
  connections[cName] = link(iName);
}
const wf = { name: 'Liquid Briefing - B v2 web research' + (local ? ' (local test)' : ''), nodes, connections, settings: { executionOrder: 'v1', binaryMode: 'separate' }, pinData: {} };
const out = path.join(__dirname, 'out', local ? 'wf_b2_local.json' : instance ? 'liquid-briefing-B2-web.TEAM-INSTANCE.workflow.json' : 'liquid-briefing-B2-web.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, nodes.length, 'nodes');
