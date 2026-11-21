// ============================================================================
// NODE: "Parse JSONL"   (Code node, Run Once for All Items)
// Input: items with binary files (Form upload, or "Read Files from Disk").
// Output: one item per article row. Rows are passed through unchanged.
// ============================================================================
const out = [];
const files = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const bin = items[i].binary || {};
  for (const key of Object.keys(bin)) {
    const name = bin[key].fileName || key;
    if (!/\.jsonl?$/i.test(name)) { files.push({ file: name, skipped: 'not .jsonl' }); continue; }
    const buf = await this.helpers.getBinaryDataBuffer(i, key);
    const lines = buf.toString('utf8').split(/\r?\n/);
    let ok = 0, bad = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push({ json: JSON.parse(line) }); ok++; } catch (e) { bad++; }
    }
    files.push({ file: name, rows: ok, parse_errors: bad });
  }
}
if (!out.length) throw new Error('No JSONL rows found. Upload the .jsonl files (workflow setting "binary mode" must be "separate"). Files seen: ' + JSON.stringify(files));
// file summary travels on the first row (removed again in the next node)
out[0].json.__files = files;
return out;
