// Builds the importable n8n workflow JSON from the code/*.js files.
const fs = require('fs');
const path = require('path');
const code = f => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');
const { randomUUID } = require('crypto');
const id = () => randomUUID();

const ifBool = (expr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
    conditions: [{ id: id(), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});

const nodes = [
  { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 300], parameters: {} },
  { name: 'Prepare article & request', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300], parameters: { jsCode: code('01_prepare.js') } },
  { name: 'Use mock LLM?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [440, 300], parameters: ifBool('={{ $json.config.USE_MOCK_LLM }}') },
  { name: 'Mock extraction', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 200], parameters: { jsCode: code('02_mock_extraction.js') } },
  {
    name: 'OpenAI extract claims', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [660, 400],
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.openai_body) }}',
      options: { timeout: 120000 },
    },
  },
  { name: 'Validate claims', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300], parameters: { jsCode: code('03_validate_claims.js') } },
  { name: 'Build script & gate', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 300], parameters: { jsCode: code('04_script_and_gate.js') } },
  { name: 'Synthesize audio?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1320, 300], parameters: ifBool('={{ $json.tts.enabled }}') },
  {
    name: 'ElevenLabs TTS', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1540, 200],
    retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: '=https://api.elevenlabs.io/v1/text-to-speech/{{ $json.tts.voice_id }}?output_format={{ $json.tts.output_format }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'audio/mpeg' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.tts.body) }}',
      options: { timeout: 120000, response: { response: { responseFormat: 'file', outputPropertyName: 'audio' } } },
    },
  },
  { name: 'Package briefing', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 300], parameters: { jsCode: code('05_package_output.js') } },
  {
    name: 'README', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-20, -60],
    parameters: {
      width: 900, height: 220,
      content: '## Milestone 2 - one article to audio with claim-level sources\nAll switches live in **CONFIG** at the top of *Prepare article & request*.\n1. Run as is: mock LLM, no audio -> must pass.\n2. Set TEST_MODE to `bad_quote`, `wrong_basis`, `advice_in_script` -> *Build script & gate* must throw "TTS BLOCKED".\n3. `USE_MOCK_LLM: false` + OpenAI credential on *OpenAI extract claims* -> real extraction (fictional fixture only).\n4. `SYNTHESIZE_AUDIO: true` + voice id + Header Auth credential (name `xi-api-key`) on *ElevenLabs TTS* -> MP3 in *Package briefing*.\nFICTIONAL INPUT ONLY until real-data processing is confirmed. Execution history stores article text.',
    },
  },
];
nodes.forEach(x => { x.id = id(); });

const main = (...targets) => ({ main: targets.map(t => (t === null ? [] : [].concat(t).map(node => ({ node, type: 'main', index: 0 })))) });
const connections = {
  'Manual Trigger': main('Prepare article & request'),
  'Prepare article & request': main('Use mock LLM?'),
  'Use mock LLM?': main('Mock extraction', 'OpenAI extract claims'),
  'Mock extraction': main('Validate claims'),
  'OpenAI extract claims': main('Validate claims'),
  'Validate claims': main('Build script & gate'),
  'Build script & gate': main('Synthesize audio?'),
  'Synthesize audio?': main('ElevenLabs TTS', 'Package briefing'),
  'ElevenLabs TTS': main('Package briefing'),
};

const wf = { name: 'Liquid Briefing - M2 one article to audio', nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
const out = path.join(__dirname, 'out', 'liquid-briefing-m2.workflow.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, nodes.length, 'nodes');
