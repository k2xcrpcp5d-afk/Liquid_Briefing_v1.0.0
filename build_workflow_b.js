// Builds Workflow B (one briefing per listener) as importable n8n JSON.
// Shared logic is copied from M2 at build time (markers in 01/03/04), so the checks stay identical.
// usage: node build_workflow_b.js [local]   (local = Webhook trigger, mock URLs, no Form ending)
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const local = process.argv[2] === 'local';
const instance = process.argv[2] === 'instance'; // pre-wired for the team's n8n: credentials + audio on
const C = f => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');
const region = (file, start, end) => { const s = C(file); const a = s.indexOf(start), b = s.indexOf(end); if (a < 0 || b < 0) throw new Error(`marker missing in ${file}`); return s.slice(s.indexOf('\n', a) + 1, b); };
const EXTRACT = region('01_prepare.js', '// <<EXTRACT_PROMPT', '// EXTRACT_PROMPT>>');
const VALIDATE = region('03_validate_claims.js', '// <<VALIDATE_CORE', '// VALIDATE_CORE>>');
const GATE = region('04_script_and_gate.js', '// <<GATE_HELPERS', '// GATE_HELPERS>>');
const code23 = C('23_extraction_requests.tmpl.js').replace('/*__EXTRACT_PROMPT__*/', EXTRACT);
const code24 = C('24_validate_batch.tmpl.js').replace('/*__VALIDATE_CORE__*/', VALIDATE);
let code25 = C('25_script_gate.tmpl.js').replace('/*__GATE_HELPERS__*/', GATE);
const code28 = C('28_verifier_request.tmpl.js').replace('/*__GATE_HELPERS__*/', GATE);
fs.writeFileSync(path.join(__dirname, 'code', '28_verifier_request.built.js'), code28);
fs.writeFileSync(path.join(__dirname, 'code', '23_extraction_requests.built.js'), code23);
fs.writeFileSync(path.join(__dirname, 'code', '24_validate_batch.built.js'), code24);
fs.writeFileSync(path.join(__dirname, 'code', '25_script_gate.built.js'), code25);
if (instance || local) code25 = code25.replace('SYNTHESIZE_AUDIO: false,', 'SYNTHESIZE_AUDIO: true, ');

const id = () => randomUUID();
const dt = name => ({ __rl: true, mode: 'name', value: name });
const ifNode = (name, expr, pos) => ({ name, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: id(), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });
const OPENAI_URL = local ? 'http://127.0.0.1:8789/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
const EL_BASE = local ? 'http://127.0.0.1:8789' : 'https://api.elevenlabs.io';
const openaiHttp = (name, pos) => ({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
  parameters: { method: 'POST', url: OPENAI_URL, authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.openai_body) }}', options: { timeout: 180000, batching: { batch: { batchSize: 5, batchInterval: 1000 } } } } });
const getAll = (name, table, pos, extra = {}) => ({ name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, executeOnce: true, ...extra,
  parameters: { resource: 'row', operation: 'get', dataTableId: dt(table), returnAll: true } });
const CLAIM_COLS = [['article_id', 'string'], ['story_id', 'string'], ['content_hash', 'string'], ['prompt_version', 'string'], ['model', 'string'], ['extraction_error', 'string'],
  ['summary', 'string'], ['claims_json', 'string'], ['verified_count', 'number'], ['rejected_count', 'number'], ['input_tokens', 'number'], ['cached_input_tokens', 'number'], ['output_tokens', 'number'],
  ['est_cost_usd', 'number'], ['created_at', 'string']];

const trigger = local
  ? { name: 'Listener onboarding', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300], webhookId: id(), parameters: { httpMethod: 'POST', path: 'lb-briefing-test', responseMode: 'lastNode', options: {} } }
  : { name: 'Listener onboarding', type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2, position: [0, 300], webhookId: id(),
      parameters: { formTitle: 'Your personal news briefing', formDescription: 'Tell us a bit about yourself, or pick a demo profile. You get an audio briefing in which every fact links to its source.',
        formFields: { values: [
          { fieldLabel: 'About you', fieldType: 'textarea', placeholder: "e.g. I'm interested in finance but not very experienced, and I'd like a calm voice.", requiredField: false },
          { fieldLabel: 'Preset', fieldType: 'dropdown', fieldOptions: { values: [{ option: 'custom (use my text)' }, { option: 'A_general_eu_90s' }, { option: 'B_fx_markets_3min' }, { option: 'W1_crypto_ai' }, { option: 'W3_nvidia_holder' }] }, requiredField: true },
          { fieldLabel: 'Length', fieldType: 'dropdown', fieldOptions: { values: [{ option: 'auto' }, { option: '60' }, { option: '90' }, { option: '120' }, { option: '180' }] }, requiredField: true },
        ] }, options: {} } };

const nodes = [
  trigger,
  { name: 'Build profile', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300], parameters: { jsCode: C('20_build_profile.js') } },
  ifNode('Parse with LLM?', '={{ $json.use_llm === true }}', [440, 300]),
  openaiHttp('OpenAI profile parser', [660, 180]),
  { name: 'Finalize profile', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300], parameters: { jsCode: C('21_finalize_profile.js') } },
  { name: 'Create lb_claims', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1100, 300], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'lb_claims', columns: { column: CLAIM_COLS.map(([name, type]) => ({ name, type })) }, options: { createIfNotExists: true } } },
  getAll('Get stories', 'lb_stories', [1320, 300]),
  getAll('Get articles', 'lb_articles', [1540, 300]),
  getAll('Get claim cache', 'lb_claims', [1760, 300], { alwaysOutputData: true }),
  { name: 'Build planner request', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1980, 300], parameters: { jsCode: C('22_select_stories.js') } },
  ifNode('Use planner?', '={{ $json.use_planner === true }}', [2090, 480]),
  { ...openaiHttp('OpenAI planner', [2200, 640]), onError: 'continueRegularOutput', maxTries: 2 },
  { name: 'Select stories', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2310, 480], parameters: { jsCode: C('31_apply_plan.js') } },
  { name: 'Build extraction requests', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2420, 300], parameters: { jsCode: code23 } },
  ifNode('All claims cached?', '={{ $json.skip === true }}', [2420, 300]),
  openaiHttp('OpenAI extract claims', [2640, 420]),
  { name: 'Validate claims (batch)', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2860, 300], parameters: { jsCode: code24 } },
  ifNode('New claims to cache?', '={{ $json._none !== true }}', [3080, 300]),
  { name: 'Insert lb_claims', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [3300, 180],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_claims'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { optimizeBulk: true } } },
  { name: 'Material check', type: 'n8n-nodes-base.code', typeVersion: 2, position: [3740, 300], executeOnce: true, parameters: { jsCode: C('29_material_check.js') } },
  { name: 'Build writer request', type: 'n8n-nodes-base.code', typeVersion: 2, position: [4180, 300], executeOnce: true, parameters: { jsCode: C('27_writer_request.js') } },
  ifNode('Use LLM writer?', '={{ $json.use_writer === true }}', [4400, 300]),
  { ...openaiHttp('OpenAI script writer', [4620, 180]), onError: 'continueRegularOutput' },
  { name: 'Check lengths', type: 'n8n-nodes-base.code', typeVersion: 2, position: [4740, 0], parameters: { jsCode: C('33_check_lengths.js') } },
  ifNode('Expand short parts?', '={{ $json.expand === true }}', [4860, 0]),
  { ...openaiHttp('OpenAI expand parts', [4980, -160]), onError: 'continueRegularOutput' },
  { name: 'Merge drafts', type: 'n8n-nodes-base.code', typeVersion: 2, position: [5100, 0], parameters: { jsCode: C('34_merge_drafts.js') } },
  { name: 'Check script & build verifier request', type: 'n8n-nodes-base.code', typeVersion: 2, position: [4840, 300], parameters: { jsCode: code28 } },
  ifNode('Verify with LLM?', '={{ $json.skip_verifier !== true }}', [5060, 300]),
  { ...openaiHttp('OpenAI script verifier', [5280, 180]), onError: 'continueRegularOutput' },
  { name: 'Build script & gate', type: 'n8n-nodes-base.code', typeVersion: 2, position: [5500, 300], executeOnce: true, parameters: { jsCode: code25 } },
  ifNode('Synthesize audio?', '={{ $json.tts.enabled === true }}', [5720, 300]),
  { name: 'ElevenLabs TTS', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [5940, 180], retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    parameters: { method: 'POST', url: `=${EL_BASE}/v1/text-to-speech/{{ $json.tts.voice_id }}/with-timestamps?output_format={{ $json.tts.output_format }}`,
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.tts.body) }}',
      options: { timeout: 180000 } } },
  { name: 'Package briefing page', type: 'n8n-nodes-base.code', typeVersion: 2, position: [6160, 300], parameters: { jsCode: C('26_package_page.js') } },
  ...(local ? [] : [{ name: 'Show briefing', type: 'n8n-nodes-base.form', typeVersion: 2.3, position: [6600, 460], webhookId: id(),
    parameters: { operation: 'completion', respondWith: 'returnBinary', inputDataFieldName: 'briefing_page', completionTitle: 'Your briefing is ready', completionMessage: 'The page with audio, transcript and sources is downloading.', options: {} } }]),
  // ---- website entry (async job) -------------------------------------------------------------
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
  // ---- website exit -------------------------------------------------------------------------------
  ifNode('From website?', "={{ (() => { try { return !!$('Accept job').first().json.job_id; } catch (e) { return false; } })() }}", [6380, 300]),
  { name: 'Audio row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [6600, 180],
    parameters: { jsCode: "const job = $('Accept job').first().json.job_id;\nconst it = $input.first();\nlet audio_b64 = null;\nif (it.binary && it.binary.audio) audio_b64 = (await this.helpers.getBinaryDataBuffer(0, 'audio')).toString('base64');\nreturn [{ json: { job_id: job, audio_b64 } }];" } },
  { name: 'Insert audio', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [6820, 180],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_audio'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  // keep only the newest audio files (Data Tables have a size limit)
  { name: 'Trim old audio', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [6820, 0], alwaysOutputData: true, onError: 'continueRegularOutput',
    parameters: { resource: 'row', operation: 'deleteRows', dataTableId: dt('lb_audio'), matchType: 'allConditions', filters: { conditions: [{ keyName: 'id', condition: 'lt', keyValue: '={{ $json.id - 6 }}' }] }, options: {} } },
  { name: 'Job row: done', type: 'n8n-nodes-base.code', typeVersion: 2, position: [7040, 180],
    parameters: { jsCode: "const job = $('Accept job').first().json.job_id;\nconst r = $('Package briefing page').first().json;\nreturn [{ json: { job_id: job, status: 'done', created_at: new Date().toISOString(), input_json: null, result_json: JSON.stringify(r), error: null } }];" } },
  { name: 'Insert job (done)', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [7260, 180],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_jobs'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  { name: 'Trim old jobs', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [7480, 180], alwaysOutputData: true, onError: 'continueRegularOutput',
    parameters: { resource: 'row', operation: 'deleteRows', dataTableId: dt('lb_jobs'), matchType: 'allConditions', filters: { conditions: [{ keyName: 'id', condition: 'lt', keyValue: '={{ $json.id - 400 }}' }] }, options: {} } },
  // ---- failures of website jobs (production runs only) -------------------------------------
  { name: 'On error', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 860], parameters: {} },
  { name: 'Job row: error', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 860],
    parameters: { jsCode: "const e = $input.first().json;\nconst msg = String((e.execution && e.execution.error && e.execution.error.message) || 'Workflow failed').split('\\nREPORT')[0].slice(0, 600);\nreturn [{ json: { job_id: String(e.execution && e.execution.id), status: 'error', created_at: new Date().toISOString(), input_json: null, result_json: null, error: msg } }];" } },
  { name: 'Insert job (error)', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [440, 860],
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_jobs'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  { name: 'README', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -60], parameters: { width: 1500, height: 250,
    content: '## Workflow B - one personal briefing per listener (needs Workflow A to have filled lb_stories / lb_articles)\n**Input:** form with free text and/or a demo preset. **Output:** downloadable HTML page (audio player, transcript with a source link per fact, *why you got this briefing*, cost).\n1. *Build profile* -> keyword rules (or the LLM parser, `USE_LLM_PROFILE_PARSER`) turn the text into a fixed profile and record WHY.\n2. *Build planner request* filters today\'s stories (news window, no advice, text available); *OpenAI planner* (gpt-6.2-sol) interprets the listener and plans the briefing (wishes, stories, roles, word budgets, reserves); *Select stories* enforces integrity only (stories exist, picks included, length fits) - rules ranking as fallback.\n3. Claims are extracted only for planned + reserve stories not cached in `lb_claims`.\n4. *Material check* fits the plan to the verified facts (no padding, reserves for thin stories); *OpenAI script writer* (gpt-6.1-terra) tells it from verified claims only; *Check script* + *OpenAI script verifier* check AND repair sentences; *Build script & gate* adds greeting/sign-off by code, fills short scripts with verified quick hits, blocks on unsupported numbers/advice, splits the audio into parts.\nOpen the result: *Package briefing page* -> Binary -> briefing_page -> Download.' } },
];
nodes.forEach(n => { n.id = id(); });
if (instance) for (const n of nodes) {
  if (n.type !== 'n8n-nodes-base.httpRequest') continue;
  n.credentials = n.name === 'ElevenLabs TTS' ? { httpHeaderAuth: { id: '7EyLg69Fv7XWRaYe', name: 'Header Auth account' } } : { openAiApi: { id: 'BzyXxdtqGGj4qBP3', name: 'OpenAI account' } };
}
const link = (...t) => ({ main: t.map(x => (x === null ? [] : [{ node: x, type: 'main', index: 0 }])) });
const connections = {
  'Listener onboarding': link('Build profile'),
  'Build profile': link('Parse with LLM?'),
  'Parse with LLM?': link('OpenAI profile parser', 'Finalize profile'),
  'OpenAI profile parser': link('Finalize profile'),
  'Finalize profile': link('Create lb_claims'),
  'Create lb_claims': link('Get stories'),
  'Get stories': link('Get articles'),
  'Get articles': link('Get claim cache'),
  'Get claim cache': link('Build planner request'),
  'Build planner request': link('Use planner?'),
  'Use planner?': link('OpenAI planner', 'Select stories'),
  'OpenAI planner': link('Select stories'),
  'Select stories': link('Build extraction requests'),
  'Build extraction requests': link('All claims cached?'),
  'All claims cached?': link('Validate claims (batch)', 'OpenAI extract claims'),
  'OpenAI extract claims': link('Validate claims (batch)'),
  'Validate claims (batch)': link('New claims to cache?'),
  'New claims to cache?': link('Insert lb_claims', 'Material check'),
  'Insert lb_claims': link('Material check'),
  'Material check': link('Build writer request'),
  'Build writer request': link('Use LLM writer?'),
  'Use LLM writer?': link('OpenAI script writer', 'Check script & build verifier request'),
  'OpenAI script writer': link('Check lengths'),
  'Check lengths': link('Expand short parts?'),
  'Expand short parts?': link('OpenAI expand parts', 'Merge drafts'),
  'OpenAI expand parts': link('Merge drafts'),
  'Merge drafts': link('Check script & build verifier request'),
  'Check script & build verifier request': link('Verify with LLM?'),
  'Verify with LLM?': link('OpenAI script verifier', 'Build script & gate'),
  'OpenAI script verifier': link('Build script & gate'),
  'Build script & gate': link('Synthesize audio?'),
  'Synthesize audio?': link('ElevenLabs TTS', 'Package briefing page'),
  'ElevenLabs TTS': link('Package briefing page'),
  'Package briefing page': link('From website?'),
  'From website?': link('Audio row', ...(local ? [null] : ['Show briefing'])),
  'Audio row': link('Insert audio'),
  'Insert audio': link('Trim old audio'),
  'Trim old audio': link('Job row: done'),
  'Job row: done': link('Insert job (done)'),
  'Insert job (done)': link('Trim old jobs'),
  'Website start': link('Accept job'),
  'Accept job': link('Respond: job accepted'),
  'Respond: job accepted': link('Create lb_jobs'),
  'Create lb_jobs': link('Create lb_audio'),
  'Create lb_audio': link('Job row: running'),
  'Job row: running': link('Insert job (running)'),
  'Insert job (running)': link('Build profile'),
  'On error': link('Job row: error'),
  'Job row: error': link('Insert job (error)'),
};
// ---- real progress for the website: a side branch per stage writes a 'running' row with { stage, progress }.
// Branches run top to bottom (execution order v1), so the side branch sits ABOVE the main line and runs first.
const STAGES = [
  ['Build planner request', 'planning', 0.12, "Picking today's stories"],
  ['Select stories', 'reading', 0.3, 'Reading the articles, pulling out facts'],
  ['Material check', 'writing', 0.5, 'Writing the script'],
  ['Check script & build verifier request', 'checking', 0.72, 'Fact-checking every sentence'],
  ['Build script & gate', 'recording', 0.84, 'Recording the audio'],
];
for (const [parent, stage, progress, label] of STAGES) {
  const par = nodes.find(n => n.name === parent);
  const [x, y] = par.position;
  const cName = `Progress: ${stage}`, iName = `Save progress: ${stage}`;
  nodes.push({ name: cName, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 120, y - 300], onError: 'continueRegularOutput',
    parameters: { jsCode: `let job = null;\ntry { job = $('Accept job').first().json.job_id; } catch (e) { return []; }\nreturn [{ json: { job_id: job, status: 'running', created_at: new Date().toISOString(), input_json: null, result_json: JSON.stringify({ stage: ${JSON.stringify(stage)}, progress: ${progress}, label: ${JSON.stringify(label)} }), error: null } }];` } });
  nodes.push({ name: iName, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [x + 340, y - 300], onError: 'continueRegularOutput',
    parameters: { resource: 'row', operation: 'insert', dataTableId: dt('lb_jobs'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } });
  connections[parent].main[0].push({ node: cName, type: 'main', index: 0 });
  connections[cName] = link(iName);
}
const wf = { name: 'Liquid Briefing - B personal briefing' + (local ? ' (local test)' : ''), nodes, connections, settings: { executionOrder: 'v1', binaryMode: 'separate' }, pinData: {} };
const out = path.join(__dirname, 'out', local ? 'wf_b_local.json' : instance ? 'liquid-briefing-B-personal-briefing.TEAM-INSTANCE.workflow.json' : 'liquid-briefing-B-personal-briefing.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, nodes.length, 'nodes');
