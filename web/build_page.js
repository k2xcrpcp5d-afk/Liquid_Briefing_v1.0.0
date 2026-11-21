// Assembles web/app.html from web/parts/* and web/config.json (Supabase URL + anon key; the anon key is public by design).
const fs = require('fs'); const path = require('path');
const P = f => fs.readFileSync(path.join(__dirname, 'parts', f), 'utf8');
let cfg = { supabase_url: '__SUPABASE_URL__', supabase_anon_key: '__SUPABASE_ANON_KEY__', api_base: '__API_BASE__' };
const cfgFile = process.argv[2] || path.join(__dirname, 'config.json');
if (fs.existsSync(cfgFile)) cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) };
const app = P('app.js').replace('/*__I18N__*/', () => P('i18n.js')).replace('/*__DEWEY__*/', () => P('dewey.js')).replace('__SUPABASE_URL__', cfg.supabase_url.replace(/\/$/, '')).replace('__SUPABASE_ANON_KEY__', cfg.supabase_anon_key).replace("'__API_BASE__'", JSON.stringify(cfg.api_base));
const html = P('page.tpl.html').replace('/*__CSS__*/', () => P('base.css') + P('extra.css')).replace('<!--__BODY__-->', () => P('body.html')).replace('/*__APP__*/', () => P('liquid-crew.js') + '\n' + app);
if (html.includes('{{')) throw new Error('page must not contain {{ (n8n expression syntax)');
const out = process.argv[3] || path.join(__dirname, 'app.html');
fs.writeFileSync(out, html); console.log('wrote', out, html.length, 'chars');
