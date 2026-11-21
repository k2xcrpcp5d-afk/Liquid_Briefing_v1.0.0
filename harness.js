// Local harness: runs the Code-node files in sequence with n8n-like globals.
// usage: node harness.js <test_mode> [--json]
const fs = require('fs');
const path = require('path');
const mode = process.argv[2] || 'none';
const dir = path.join(__dirname, 'code');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const outputs = {};
function run(name, file, input, patch) {
  let src = read(file);
  if (patch) src = patch(src);
  const $ = n => { if (!outputs[n]) throw new Error(`no output for ${n}`); return { first: () => outputs[n][0], all: () => outputs[n] }; };
  const $input = { first: () => input[0], all: () => input };
  const fn = new Function('$', '$input', '$execution', 'require', `return (function(){${src}\n})();`);
  const out = fn($, $input, { id: 'local' }, require);
  outputs[name] = out;
  return out;
}

try {
  const p = run('Prepare article & request', '01_prepare.js', [], s => s.replace("TEST_MODE: 'none'", `TEST_MODE: '${mode}'`));
  const m = run('Mock extraction', '02_mock_extraction.js', p);
  const v = run('Validate claims', '03_validate_claims.js', m);
  const g = run('Build script & gate', '04_script_and_gate.js', v);
  const out = run('Package briefing', '05_package_output.js', g);
  if (process.argv.includes('--json')) console.log(JSON.stringify(out[0].json, null, 2));
  else {
    console.log(`MODE=${mode} -> PASSED (TTS allowed)`);
    console.log(out[0].json.debug_internal.tts_text);
    console.log(JSON.stringify(out[0].json.usage.totals));
  }
} catch (e) {
  console.log(`MODE=${mode} -> ${e.message.split('\nREPORT')[0]}`);
  if (process.argv.includes('--json')) console.log(e.message.split('\nREPORT ')[1]);
  process.exitCode = mode === 'none' ? 1 : 0;
}
