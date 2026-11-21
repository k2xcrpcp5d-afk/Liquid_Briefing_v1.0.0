// Builds Workflow E (archive import) as importable n8n JSON.
// usage: node build_workflow_e.js [local]   (local = Manual Trigger + Read Files from Disk)
const fs = require('fs'), path = require('path'), { randomUUID } = require('crypto');
const local = process.argv[2] === 'local';
const code = f => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');
const id = () => randomUUID();
const dt = name => ({ __rl: true, mode: 'name', value: name });
const insert = (name, table, pos) => ({ name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos,
  parameters: { resource: 'row', operation: 'insert', dataTableId: dt(table), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { optimizeBulk: true } } });
const rows = (name, type, pos) => ({ name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos,
  parameters: { jsCode: `return $('Archive rows').all().filter(i => i.json._type === '${type}').map(i => { const { _type, ...row } = i.json; return { json: row }; });` } });
const trigger = local
  ? [{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-220, 300], parameters: {} },
     { name: 'Read JSONL from disk', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: [0, 300], parameters: { operation: 'read', fileSelector: './data/zacks.jsonl', options: {} } }]
  : [{ name: 'Upload zacks.jsonl', type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2, position: [0, 300], webhookId: id(),
       parameters: { formTitle: 'Liquid Briefing - add the archive', formDescription: 'Upload zacks.jsonl (or all six files). Only articles older than 12 Nov are added; nothing existing is changed.',
         formFields: { values: [{ fieldLabel: 'jsonl_files', fieldType: 'file', multipleFiles: true, acceptFileTypes: '.jsonl', requiredField: true }] }, options: {} } }];
const tName = trigger[trigger.length - 1].name;
const nodes = [...trigger,
  { name: 'Parse JSONL', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300], parameters: { jsCode: code('09_parse_jsonl.js') } },
  { name: 'Existing stories', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [440, 300], executeOnce: true, alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: dt('lb_stories'), returnAll: true } },
  { name: 'Archive rows', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 300], parameters: { jsCode: code('14_archive_rows.js') } },
  rows('Story rows', 'story_row', [880, 300]), insert('Insert lb_stories', 'lb_stories', [1100, 300]),
  rows('Article rows', 'article_row', [1320, 300]), insert('Insert lb_articles', 'lb_articles', [1540, 300]),
  { name: 'Report', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 300], executeOnce: true,
    parameters: { jsCode: "const r = $('Archive rows').all().find(i => i.json._type === 'report').json;\nreturn [{ json: { ...r } }];" } },
  { name: 'README', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -60], parameters: { width: 900, height: 200,
    content: '## Workflow E - add the archive (run once)\nAdds the Zacks articles from 28 Jul to 11 Nov (older than Workflow A\'s grouping window) to lb_articles, one story each (phase = archive).\nB finds them only when a listener\'s own words match (search step), and says when they were reported. No LLM, no cost.\nThen run Workflow D (pre-extraction) with ?from=2026-07-01 to extract their facts.' } }];
nodes.forEach(n => { n.id = id(); });
const link = (...t) => ({ main: t.map(x => [{ node: x, type: 'main', index: 0 }]) });
const connections = { ...(local ? { 'Manual Trigger': link('Read JSONL from disk') } : {}), [tName]: link('Parse JSONL'), 'Parse JSONL': link('Existing stories'),
  'Existing stories': link('Archive rows'), 'Archive rows': link('Story rows'), 'Story rows': link('Insert lb_stories'), 'Insert lb_stories': link('Article rows'),
  'Article rows': link('Insert lb_articles'), 'Insert lb_articles': link('Report') };
const wf = { name: 'Liquid Briefing - E add archive' + (local ? ' (local test)' : ''), nodes, connections, settings: { executionOrder: 'v1', binaryMode: 'separate' }, pinData: {} };
const out = path.join(__dirname, 'out', local ? 'wf_e_local.json' : 'liquid-briefing-E-add-archive.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2)); console.log('wrote', out, nodes.length, 'nodes');
