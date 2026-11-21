// Builds Workflow C: the website (GET lb-app) and its read API (lb-status, lb-audio). Workflow B owns lb-start.
// usage: node build_workflow_c.js [local]
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const local = process.argv[2] === 'local';
const id = () => randomUUID();
// page = web/parts/* + Supabase config (web/config.json; local test: web/config.local.json)
const pageOut = path.join(__dirname, 'web', local ? 'app.local.html' : 'app.html');
require('child_process').execFileSync('node', [path.join(__dirname, 'web', 'build_page.js'), path.join(__dirname, 'web', local ? 'config.local.json' : 'config.json'), pageOut], { stdio: 'inherit' });
const html = fs.readFileSync(pageOut, 'utf8');
if (html.includes('{{')) throw new Error('page must not contain {{ (n8n expression syntax)');
const sfx = local ? '-local' : '';
const page = html;
const dt = name => ({ __rl: true, mode: 'name', value: name });
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'no-store' }];
const hook = (name, p, pos) => ({ name, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos, webhookId: id(), parameters: { httpMethod: 'GET', path: p + sfx, responseMode: 'responseNode', options: {} } });
const getRows = (name, table, pos) => ({ name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, alwaysOutputData: true,
  parameters: { resource: 'row', operation: 'get', dataTableId: dt(table), matchType: 'anyCondition', filters: { conditions: [{ keyName: 'job_id', condition: 'eq', keyValue: '={{ $json.query.job }}' }] }, returnAll: true } });

const nodes = [
  hook('Website', 'lb-app', [0, 0]),
  { name: 'Send page', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [240, 0],
    parameters: { respondWith: 'text', responseBody: page, options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }] } } } },

  hook('Status API', 'lb-status', [0, 240]),
  getRows('Get job rows', 'lb_jobs', [240, 240]),
  { name: 'Job status', type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 240],
    parameters: { jsCode: `const job = String($('Status API').first().json.query.job || '');
const rows = $input.all().map(i => i.json).filter(r => r.job_id === job);
const running = rows.filter(r => r.status === 'running').sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
const pick = rows.find(r => r.status === 'done') || rows.find(r => r.status === 'error') || running[0];
if (!pick) return [{ json: { job_id: job, status: 'unknown' } }];
let result = null;
try { result = pick.result_json ? JSON.parse(pick.result_json) : null; } catch (e) { result = null; }
if (pick.status === 'running') {
  // real progress: the furthest stage any progress row reached (rows can arrive out of order)
  const st = running.map(r => { try { return JSON.parse(r.result_json || '{}'); } catch (e) { return {}; } }).filter(x => typeof x.progress === 'number').sort((a, b) => b.progress - a.progress)[0] || { stage: 'start', progress: 0.04, label: 'Starting' };
  return [{ json: { job_id: job, status: 'running', stage: st.stage, progress: st.progress, label: st.label || null, stages_done: running.length } }];
}
return [{ json: { job_id: job, status: pick.status, error: pick.error || null, has_audio: !!(result && result.audio_available), progress: pick.status === 'done' ? 1 : null, result } }];` } },
  { name: 'Send status', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [720, 240],
    parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseHeaders: { entries: CORS } } } },

  hook('Topics API', 'lb-topics', [0, 720]),
  { name: 'Get stories', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [240, 720], alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: dt('lb_stories'), returnAll: true } },
  { name: "Today's topics", type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 720], parameters: { jsCode: fs.readFileSync(path.join(__dirname, 'code', '30_today_topics.js'), 'utf8') } },
  { name: 'Send topics', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [720, 720],
    parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseHeaders: { entries: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'public, max-age=300' }] } } } },
  hook('Audio API', 'lb-audio', [0, 480]),
  getRows('Get audio row', 'lb_audio', [240, 480]),
  { name: 'To MP3', type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 480],
    parameters: { jsCode: `const job = String($('Audio API').first().json.query.job || '');
const row = $input.all().map(i => i.json).find(r => r.job_id === job && r.audio_b64);
if (!row) throw new Error('No audio for this job');
const bin = await this.helpers.prepareBinaryData(Buffer.from(row.audio_b64, 'base64'), 'briefing_' + job + '.mp3', 'audio/mpeg');
return [{ json: { job_id: job }, binary: { data: bin } }];` } },
  { name: 'Send MP3', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [720, 480],
    parameters: { respondWith: 'binary', responseDataSource: 'set', inputFieldName: 'data', options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'audio/mpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'public, max-age=86400' }] } } } },
  { name: 'README', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -280], parameters: { width: 900, height: 220,
    content: '## Workflow C - Liquid Briefing website\n**Publish this workflow AND Workflow B** (toggle top right), then open the production URL of *Website*: `https://<your-n8n>/webhook/lb-app`.\n- `lb-app` serves the page (Design System v1, Dewey).\n- The page calls `lb-start` (Workflow B: starts a briefing job, returns job_id), then polls `lb-status` and plays `lb-audio`.\n- Jobs live in Data Tables `lb_jobs` / `lb_audio` (written by Workflow B).\nTo change the page: edit `web/app.html`, run `node build_workflow_c.js`, re-import.' } },
];
nodes.forEach(n => { n.id = id(); });
const link = (...t) => ({ main: t.map(x => (x === null ? [] : [{ node: x, type: 'main', index: 0 }])) });
const connections = {
  'Website': link('Send page'),
  'Status API': link('Get job rows'), 'Get job rows': link('Job status'), 'Job status': link('Send status'),
  'Topics API': link('Get stories'), 'Get stories': link("Today's topics"), "Today's topics": link('Send topics'),
  'Audio API': link('Get audio row'), 'Get audio row': link('To MP3'), 'To MP3': link('Send MP3'),
};
const wf = { name: 'Liquid Briefing - C website' + (local ? ' (local test)' : ''), nodes, connections, settings: { executionOrder: 'v1', binaryMode: 'separate' }, pinData: {} };
const out = path.join(__dirname, 'out', local ? 'wf_c_local.json' : 'liquid-briefing-C-website.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, nodes.length, 'nodes');
