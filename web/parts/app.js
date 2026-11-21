{
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SB_URL = '__SUPABASE_URL__';
const SB_KEY = '__SUPABASE_ANON_KEY__';
const SFX = /lb-app-local\/?$/.test(location.pathname) ? '-local' : ''; // local test build
const API_BASE = '__API_BASE__'; // set when the page is hosted outside n8n (e.g. GitHub Pages)
const BASE = /^__API/.test(API_BASE) ? location.pathname.replace(/lb-app(-local)?\/?$/, '') : API_BASE;
const API = p => BASE + p + SFX;

/*__I18N__*/
/*__DEWEY__*/
$('logoDrop').innerHTML = dewey('happy', 34);
$('errDewey').innerHTML = dewey('oops', 150);

// ---- Deweys Crew: the five hosts (Character PDF + Voice Guide); words come from STR ----------
const CREW_BASE = [
  { id: 'pip', name: 'Pip', tag: 'Before Class', tile: '#9ED8FA', shade: '#C9CCD2', voice: 'Will · 1.05×' },
  { id: 'tide', name: 'Tide', tag: 'Before Markets', tile: '#0B0B0F', shade: '#2A2B31', dark: true, voice: 'Daniel · 1.1×' },
  { id: 'flo', name: 'Flo', tag: 'Before the Shift', tile: '#EEF0F3', shade: '#C9CCD2', voice: 'River · 1.0×' },
  { id: 'brook', name: 'Brook', tag: 'Before Opening', tile: '#F0F9FF', shade: '#C9CCD2', voice: 'George · 0.98×' },
  { id: 'rain', name: 'Rain', tag: 'Before the School Run', tile: '#1F6FA3', shade: '#16507A', dark: true, voice: 'Matilda · 0.95×' },
];
const CREW_IDS = CREW_BASE.map(c => c.id);
const CR = id => { const b = CREW_BASE.find(c => c.id === id) || CREW_BASE[0]; return { ...b, ...tr('crew')[b.id] }; };
const TICK = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW = d => `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#0B0B0F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MIN = { short: 3, medium: 5, long: 10 };
const LEN_IDS = ['short', 'medium', 'long'];
const TOPIC_IDS = ['macro', 'fx_central_banks', 'stocks', 'ai_tech', 'commodities', 'personal_finance', 'crypto', 'world_politics'];
const COMPANIES = [['nvidia', 'Nvidia'], ['apple', 'Apple'], ['microsoft', 'Microsoft'], ['tesla', 'Tesla'], ['openai', 'OpenAI'], ['asml', 'ASML'], ['amazon', 'Amazon'], ['bitcoin', 'Bitcoin'], ['gold', 'Gold'], ['oil', 'Oil']];

// 3D host carousel: floating hosts in depth; drag/swipe, arrows, keys, dots; the front host is the pick
function makeCarousel(root, initial, onPick) {
  const n = CREW_BASE.length;
  root.innerHTML = `<div class="carousel" tabindex="0" role="listbox" aria-label="${esc(t('chooseHostAria'))}"><div class="car-track">${CREW_BASE.map((c, i) => `<div class="car-item" data-i="${i}" role="option" aria-label="${esc(c.name)}, ${esc(c.tag)}"><div class="car-float" style="animation-delay:${(-i * 0.7).toFixed(1)}s"><lb-crew who="${c.id}" mode="idle"></lb-crew></div></div>`).join('')}</div>
    <div class="car-label" aria-live="polite"><b></b><span class="ctag"></span></div>
    <button type="button" class="car-nav prev" aria-label="${esc(t('prevHost'))}">${ARROW('M15 5l-7 7 7 7')}</button><button type="button" class="car-nav next" aria-label="${esc(t('nextHost'))}">${ARROW('M9 5l7 7-7 7')}</button></div>
    <div class="car-dots">${CREW_BASE.map((c, i) => `<button type="button" data-d="${i}" aria-label="${esc(c.name)}"></button>`).join('')}</div>`;
  const car = root.querySelector('.carousel'), items = [...root.querySelectorAll('.car-item')], dots = [...root.querySelectorAll('.car-dots button')];
  let idx = Math.max(0, CREW_IDS.indexOf(initial)), cw = 224, gap = 170, prevD = items.map(() => null), picked = null;
  const norm = d => ((d % n) + n + n / 2) % n - n / 2;
  function size() { const w = car.clientWidth || 600; cw = Math.round(Math.min(250, Math.max(190, w * 0.44))); gap = Math.round(w < 560 ? cw * 0.72 : Math.min(cw * 0.95, (w - cw) / 2 * 0.85)); car.style.setProperty('--cw', cw + 'px'); car.style.height = Math.round(cw * 0.95 + 112) + 'px'; }
  function layout() {
    items.forEach((it, i) => {
      const d = norm(i - idx), a = Math.abs(d);
      const tf = `translateX(${(d * gap).toFixed(1)}px) translateZ(${(-a * 340).toFixed(0)}px) translateY(${(-a * 26).toFixed(0)}px)`;
      if (prevD[i] != null && Math.abs(d - prevD[i]) > 1.5) { it.style.transition = 'none'; it.style.transform = tf; void it.offsetWidth; it.style.transition = ''; } else it.style.transform = tf;
      it.style.opacity = a > 2.3 ? 0 : (1 - Math.min(a, 2) * 0.2).toFixed(2);
      it.style.zIndex = String(100 - Math.round(a * 10));
      prevD[i] = d;
    });
  }
  function settle(i, greet) {
    idx = ((Math.round(i) % n) + n) % n; layout();
    const c = CREW_BASE[idx];
    items.forEach((it, k) => { it.classList.toggle('on', k === idx); it.setAttribute('aria-selected', k === idx); });
    dots.forEach((d, k) => d.setAttribute('aria-current', k === idx));
    root.querySelector('.car-label b').textContent = c.name; root.querySelector('.car-label .ctag').textContent = c.tag;
    if (c.id !== picked) { picked = c.id; if (greet !== false) { const cr = items[idx].querySelector('lb-crew'); if (cr && cr.hello && !REDUCE) setTimeout(() => cr.hello(t('hello', { h: c.name })), 260); } onPick(c.id); }
  }
  const go = k => settle(Math.round(idx) + k);
  root.querySelector('.prev').onclick = () => go(-1); root.querySelector('.next').onclick = () => go(1);
  dots.forEach(d => (d.onclick = () => { const k = Number(d.dataset.d); settle(Math.round(idx) + norm(k - idx)); }));
  car.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } });
  let x0 = null, i0 = 0, moved = 0;
  car.addEventListener('pointerdown', e => { if (e.target.closest('.car-nav')) return; x0 = e.clientX; i0 = idx; moved = 0; });
  car.addEventListener('pointermove', e => {
    if (x0 == null) return;
    const dx = e.clientX - x0; moved = Math.max(moved, Math.abs(dx));
    if (moved > 6) { if (!car.classList.contains('dragging')) { car.classList.add('dragging'); try { car.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } } idx = i0 - dx / gap; layout(); }
  });
  const end = e => {
    if (x0 == null) return;
    const wasDrag = car.classList.contains('dragging');
    car.classList.remove('dragging'); x0 = null;
    if (wasDrag) { settle(idx); return; }
    const it = e.target.closest && e.target.closest('.car-item');
    if (it) { const k = Number(it.dataset.i); settle(Math.round(idx) + norm(k - idx)); }
  };
  car.addEventListener('pointerup', end); car.addEventListener('pointercancel', () => { car.classList.remove('dragging'); x0 = null; settle(idx); });
  window.addEventListener('resize', () => { size(); layout(); });
  size(); settle(idx, false);
  requestAnimationFrame(() => { size(); layout(); });
  return { set(id) { const k = CREW_IDS.indexOf(id); if (k >= 0) settle(Math.round(idx) + norm(k - idx)); } };
}
function hostCard(id) {
  const c = CR(id);
  return `<p class="hc-line">${esc(c.line)}</p><div class="hc-traits">${c.traits.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
}
function paintStage(stage, crew, id) { const c = CR(id); stage.style.background = c.tile; stage.style.setProperty('--lb-shade', c.shade); crew.setAttribute('who', c.id); }
const defaultCrew = p => (p && CREW_IDS.includes(p.character)) ? p.character : ({ student: 'pip', investor: 'tide', founder: 'brook', professional: 'brook' }[p && p.identity] || (p && p.expertise === 'expert' ? 'tide' : 'pip'));
// segmented control: two lines per option (label + small line)
function seg(el, opts, cur, onPick) {
  el.innerHTML = opts.map(([k, a, b]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${cur === k}"><b>${esc(a)}</b>${b ? `<span>${esc(b)}</span>` : ''}</button>`).join('');
  el.onclick = e => { const btn = e.target.closest('[data-v]'); if (!btn) return; for (const x of el.children) x.setAttribute('aria-pressed', x === btn); onPick(btn.dataset.v); };
}
const langOpts = () => LANGS.map(([k, n, c]) => [k, n, c]);
const lenOpts = () => LEN_IDS.map(k => [k, tr('lens')[k][0], tr('lens')[k][1]]);
// country picker: search box + matches (names in the UI language, English names match too)
function countryPicker(el, cur, onPick) {
  el.innerHTML = `<div class="csearch"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#0B0B0F" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" class="cinput" autocomplete="country-name" aria-label="${esc(t('country'))}" placeholder="${esc(t('countryPh'))}"></div><div class="clist" role="listbox" aria-label="${esc(t('country'))}"></div>`;
  const inp = el.querySelector('input'), list = el.querySelector('.clist');
  let sel = cur || null;
  const all = ISO.map(c => ({ c, n: countryName(c), e: countryName(c, 'en') })).sort((a, b) => a.n.localeCompare(b.n, LANG));
  function draw() {
    const q = inp.value.trim().toLowerCase();
    let hits = q ? all.filter(x => x.n.toLowerCase().includes(q) || x.e.toLowerCase().includes(q) || x.c.toLowerCase() === q) : TOP_COUNTRIES.map(c => all.find(x => x.c === c)).filter(Boolean);
    if (sel && !hits.some(x => x.c === sel) && !q) hits = [all.find(x => x.c === sel), ...hits].filter(Boolean);
    hits = hits.slice(0, 6);
    list.innerHTML = hits.length ? hits.map(x => `<button type="button" role="option" data-c="${x.c}" aria-selected="${x.c === sel}"><span>${esc(x.n)}</span>${x.c === sel ? `<i class="ctick2">${TICK}</i>` : ''}</button>`).join('') : `<p class="hint" style="margin:10px 14px">${esc(t('noCountry'))}</p>`;
  }
  inp.addEventListener('input', draw);
  list.onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; sel = b.dataset.c; inp.value = ''; draw(); onPick(sel); };
  draw();
}

const VIEWS = ['vAuth', 'vOnb', 'vProfile', 'vGen', 'vWork', 'vResult', 'vErr'];
let curView = 'vAuth';
function show(v) {
  curView = v;
  for (const id of VIEWS) $(id).classList.toggle('hidden', id !== v);
  const inApp = !!profile && !['vAuth', 'vOnb', 'vProfile'].includes(v);
  $('hdrProfile').classList.toggle('hidden', !inApp); $('hdrPill').classList.toggle('hidden', inApp || v === 'vOnb' || v === 'vProfile');
  window.scrollTo(0, 0);
}
function setLang(l) { if (!['en', 'de', 'nl'].includes(l)) return; LANG = l; applyStatic(); setMode(mode); renderAuthLang(); }

// ---- session (memory; sessionStorage when the browser allows it) --------------------------
let session = null, profile = null;
const store = {
  get() { try { return JSON.parse(sessionStorage.getItem('lb_session') || 'null'); } catch (e) { return null; } },
  set(v) { try { v ? sessionStorage.setItem('lb_session', JSON.stringify(v)) : sessionStorage.removeItem('lb_session'); } catch (e) { /* sandboxed page: memory only */ } },
};
async function sb(path, opt = {}) {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json', ...(opt.headers || {}) };
  if (session && !opt.anon) headers.Authorization = 'Bearer ' + session.access_token;
  const r = await fetch(SB_URL + path, { method: opt.method || 'GET', headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (r.status === 401 && session && !opt.anon) { logout(t('expired')); throw new Error('session expired'); }
  if (!r.ok) throw new Error((data && (data.msg || data.error_description || data.message || data.error)) || ('Request failed (' + r.status + ')'));
  return data;
}
async function saveProfile(row) {
  const r = await sb('/rest/v1/profiles?on_conflict=id', { method: 'POST', body: { id: session.user_id, ...row, updated_at: new Date().toISOString() }, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  profile = r && r[0] ? r[0] : { ...(profile || {}), ...row };
  return profile;
}

// ---- auth ---------------------------------------------------------------------------------
let mode = 'in';
function setMode(m) {
  mode = m;
  $('tabIn').setAttribute('aria-pressed', m === 'in'); $('tabUp').setAttribute('aria-pressed', m === 'up');
  $('authGo').textContent = t(m === 'in' ? 'login' : 'signup');
  $('pw').autocomplete = m === 'in' ? 'current-password' : 'new-password';
}
function renderAuthLang() { seg($('authLang'), LANGS.map(([k, , c]) => [k, c, '']), LANG, l => setLang(l)); }
$('tabIn').onclick = () => { setMode('in'); $('authMsg').textContent = ''; }; $('tabUp').onclick = () => { setMode('up'); $('authMsg').textContent = ''; };
$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim(), password = $('pw').value;
  $('authGo').disabled = true; $('authMsg').className = 'msg'; $('authMsg').textContent = '';
  try {
    const d = mode === 'in'
      ? await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, anon: true })
      : await sb('/auth/v1/signup', { method: 'POST', body: { email, password }, anon: true });
    if (!d || !d.access_token) throw new Error(mode === 'up' ? t('errConfirm') : t('errLoginFail'));
    session = { access_token: d.access_token, user_id: d.user.id, email: d.user.email };
    store.set(session);
    await afterLogin();
  } catch (err) {
    $('authMsg').textContent = /invalid login/i.test(err.message) ? t('errLogin') : /already registered/i.test(err.message) ? t('errTaken') : err.message;
  } finally { $('authGo').disabled = false; }
});
function logout(msg) { session = null; profile = null; store.set(null); setMode('in'); show('vAuth'); $('authMsg').textContent = msg || ''; }

async function afterLogin() {
  const rows = await sb('/rest/v1/profiles?select=*&id=eq.' + encodeURIComponent(session.user_id));
  profile = rows && rows[0] ? rows[0] : null;
  if (profile && profile.language) setLang(profile.language);
  if (profile) openGen(); else openOnboarding(null);
}

// ---- onboarding: find your host ------------------------------------------------------------
// name -> country & language -> 6 quiz questions -> follow & length -> reveal
const QUIZ = [
  [{ pip: 3 }, { tide: 3 }, { flo: 3 }, { brook: 3 }, { rain: 3 }],
  [{ pip: 2, flo: 1 }, { tide: 2, brook: 1 }, { flo: 2 }, { brook: 2 }, { rain: 2, pip: 1 }],
  [{ pip: 2 }, { tide: 2 }, { flo: 2 }, { brook: 2 }, { rain: 2 }],
  [{ pip: 1, rain: 1 }, { tide: 2 }, { flo: 2 }, { brook: 2 }],
  [{ pip: 1, rain: 1 }, {}, { tide: 1 }],
  null, // topics (multi)
];
const LEVELS = ['beginner', 'intermediate', 'expert'];
const PHASES = ['name', 'place', 'quiz', 'follow', 'reveal'];
let draft = null, phase = 0, qi = 0;
function scores(answers) {
  const s = { pip: 0, tide: 0, flo: 0, brook: 0, rain: 0 };
  answers.forEach((a, i) => { if (a == null || !QUIZ[i]) return; const w = QUIZ[i][a] || {}; for (const k of Object.keys(w)) s[k] += w[k]; });
  return s;
}
function bestHost(answers) {
  const s = scores(answers), max = Math.max(...Object.values(s));
  const top = CREW_IDS.filter(k => s[k] === max);
  if (top.length === 1) return top[0];
  const tie = [answers[2], answers[0]].map(a => (a != null ? CREW_IDS[a] : null)).find(k => k && top.includes(k));
  return tie || top[0];
}
function openOnboarding(p, start) {
  draft = p ? { ...p, topics: [...(p.topics || [])], companies: [...(p.companies || [])], answers: (p.quiz && p.quiz.answers) ? [...p.quiz.answers] : [null, null, null, null, null, null] }
    : { display_name: '', country: null, language: LANG, topics: [], companies: [], expertise: null, default_length: 'short', answers: [null, null, null, null, null, null] };
  if (!draft.language) draft.language = LANG;
  phase = start === 'quiz' ? 2 : 0; qi = 0;
  renderOnb(); show('vOnb');
}
function renderOnb() {
  const ph = PHASES[phase];
  $('onbStep').textContent = ph === 'quiz' ? t('qOf', { i: qi + 1, n: QUIZ.length }) : ph === 'reveal' ? '' : t('step', { i: phase + 1, n: 4 });
  $('onbBar').innerHTML = ph === 'quiz' ? `<div class="qbar"><i style="width:${Math.round((qi + 1) / QUIZ.length * 100)}%"></i></div>` : ph === 'reveal' ? '' : `<div class="pbar">${[0, 1, 2, 3].map(i => `<i class="${i <= phase ? 'on' : ''}"></i>`).join('')}</div>`;
  $('onbMsg').textContent = '';
  $('onbNav').classList.toggle('hidden', ph === 'reveal');
  $('onbBack').style.visibility = phase === 0 && !profile ? 'hidden' : 'visible';
  $('onbBack').textContent = phase === 0 ? t('cancel') : t('back');
  $('onbNext').textContent = ph === 'name' ? t('letsGo') : ph === 'quiz' && qi === QUIZ.length - 1 ? t('almost') : ph === 'follow' ? t('meetHost') : t('next');
  const S = $('step');
  if (ph === 'name') {
    S.innerHTML = `<div class="deweybox"><div id="onbDewey"></div><p class="db-t">${esc(t('hiDewey'))}</p><p class="db-p">${esc(t('deweyIntro'))}</p></div>
      <label class="ask" for="nameIn">${esc(t('askName'))}</label><input class="txt" id="nameIn" maxlength="30" autocomplete="given-name" placeholder="${esc(t('namePh'))}" value="${esc(draft.display_name || '')}"><p class="hint">${esc(t('nameHint'))}</p>`;
    $('onbDewey').innerHTML = dewey('happy', 150);
    const n = $('nameIn'); n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onbNext(); } });
  } else if (ph === 'place') {
    S.innerHTML = `<p class="ask">${esc(t('whereAreYou', { n: draft.display_name }))}</p><p class="hc-lab">${esc(t('country'))}</p><div id="onbCountry"></div><p class="hint">${esc(t('countryHint'))}</p>
      <p class="hc-lab" style="margin-top:18px">${esc(t('language'))}</p><div class="segfull" id="onbLang" role="group" aria-label="${esc(t('language'))}"></div><p class="hint">${esc(t('langHint'))}</p>`;
    countryPicker($('onbCountry'), draft.country, c => { draft.country = c; });
    seg($('onbLang'), langOpts(), draft.language, l => { draft.language = l; setLang(l); renderOnb(); });
  } else if (ph === 'quiz') {
    const Q = tr('quiz')[qi], s = scores(draft.answers), max = Math.max(1, ...Object.values(s)), lead = Math.max(...Object.values(s)) > 0 ? bestHost(draft.answers) : null;
    const crew = CREW_BASE.map(c => { const f = s[c.id] / max; return `<div class="qm${c.id === lead ? ' lead' : ''}" style="opacity:${(0.45 + 0.55 * f).toFixed(2)};transform:translateY(${Math.round(-14 * f)}px) scale(${(0.86 + 0.14 * f).toFixed(2)})"><lb-crew who="${c.id}" mode="idle"></lb-crew><span>${c.name}</span></div>`; }).join('');
    const multi = !QUIZ[qi];
    const opts = multi ? TOPIC_IDS.map(k => [k, tr('topics')[k], draft.topics.includes(k)]) : Q.o.map((o, k) => [String(k), o, draft.answers[qi] === k]);
    S.innerHTML = `<div class="qcrew" aria-hidden="true">${crew}</div><p class="hint" style="text-align:center;margin:6px 0 0">${esc(t('crewMoves'))}</p>
      <p class="ask">${esc(Q.q)}</p>${multi ? `<p class="hint" style="margin-top:-6px">${esc(t('pickMany'))}</p>` : ''}
      <div class="qopts" id="qopts">${opts.map(([k, l, on]) => `<button type="button" class="qopt" data-k="${esc(k)}" aria-pressed="${on}"><span>${esc(l)}</span><i class="ctick2">${TICK}</i></button>`).join('')}</div>`;
    $('qopts').onclick = e => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      if (multi) { const k = b.dataset.k, i = draft.topics.indexOf(k); i < 0 ? draft.topics.push(k) : draft.topics.splice(i, 1); b.setAttribute('aria-pressed', i < 0); }
      else { draft.answers[qi] = Number(b.dataset.k); renderOnb(); }
    };
  } else if (ph === 'follow') {
    S.innerHTML = `<p class="ask">${esc(t('followQ'))}</p><p class="hint" style="margin-top:-6px">${esc(t('followHint'))}</p>
      <div class="row" id="onbFollow" style="margin-top:12px">${COMPANIES.map(([k, l]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${draft.companies.includes(k)}">${esc(l)}</button>`).join('')}</div>
      <p class="ask" style="margin-top:24px">${esc(t('usualLen'))}</p><div class="segfull" id="onbLen" role="group" aria-label="Length"></div><p class="hint">${esc(t('lenHint'))}</p>`;
    $('onbFollow').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k, i = draft.companies.indexOf(k); i < 0 ? draft.companies.push(k) : draft.companies.splice(i, 1); b.setAttribute('aria-pressed', i < 0); };
    seg($('onbLen'), lenOpts(), draft.default_length, v => { draft.default_length = v; });
  } else renderReveal();
}
function renderReveal(keepHost) {
  if (!keepHost) draft.character = bestHost(draft.answers);
  const c = CR(draft.character);
  $('step').innerHTML = `<div class="rv-stage" style="--lb-shade:#7CC6F2"><span class="phase">${esc(t('yourHost'))}</span>
      <div class="rv-bubble">${esc(c.hi.replace('{n}', draft.display_name || ''))}</div>
      <div class="rv-ring"></div><div class="rv-ring r2"></div><div class="rv-splash s1"></div><div class="rv-splash s2"></div><div class="rv-splash s3"></div><div class="rv-splash s4"></div>
      <div class="rv-host"><div class="rv-float"><lb-crew who="${c.id}" mode="idle"></lb-crew></div></div></div>
    <div class="rv-name"><b>${esc(c.name)}</b><span class="ctag">${esc(c.tag)}</span></div>
    <div class="rv-rest"><p class="hc-line" style="font-size:18px">${esc(c.line)}</p><div class="hc-traits">${c.traits.map(x => `<span>${esc(x)}</span>`).join('')}</div>
      <button class="btn wide" id="rvGo" type="button" style="margin-top:16px">${esc(t('startWith', { h: c.name }))}</button>
      <button class="linkbtn" id="rvOthers" type="button" style="margin-top:12px">${esc(t('otherHosts'))}</button>
      <div id="rvCarWrap" class="hidden" style="width:100%;margin-top:12px"><div id="rvCar"></div></div></div>`;
  $('rvGo').onclick = finishOnb;
  $('rvOthers').onclick = () => {
    $('rvCarWrap').classList.remove('hidden'); $('rvOthers').classList.add('hidden');
    makeCarousel($('rvCar'), draft.character, id => {
      if (id === draft.character) return;
      draft.character = id; const h = CR(id);
      document.querySelector('.rv-host lb-crew').setAttribute('who', id);
      document.querySelector('.rv-bubble').textContent = h.hi.replace('{n}', draft.display_name || '');
      document.querySelector('.rv-name b').textContent = h.name; document.querySelector('.rv-name .ctag').textContent = h.tag;
      document.querySelector('.rv-rest .hc-line').textContent = h.line;
      document.querySelector('.rv-rest .hc-traits').innerHTML = h.traits.map(x => `<span>${esc(x)}</span>`).join('');
      $('rvGo').textContent = t('startWith', { h: h.name });
    });
  };
}
function onbNext() {
  const ph = PHASES[phase];
  if (ph === 'name') { draft.display_name = $('nameIn').value.trim(); if (!draft.display_name) { $('onbMsg').textContent = t('needName'); return; } }
  if (ph === 'place' && !draft.country) { $('onbMsg').textContent = t('needCountry'); return; }
  if (ph === 'quiz') {
    if (QUIZ[qi] && draft.answers[qi] == null) { $('onbMsg').textContent = t('pickOne'); return; }
    if (!QUIZ[qi] && !draft.topics.length) { $('onbMsg').textContent = t('pickTopic'); return; }
    if (qi < QUIZ.length - 1) { qi++; renderOnb(); window.scrollTo(0, 0); return; }
  }
  phase++; qi = 0; renderOnb(); window.scrollTo(0, 0);
}
function onbBack() {
  const ph = PHASES[phase];
  if (phase === 0) { if (profile) openAccount('profile'); return; }
  if (ph === 'quiz' && qi > 0) { qi--; renderOnb(); return; }
  if (ph === 'follow') { phase = 2; qi = QUIZ.length - 1; renderOnb(); return; }
  phase--; renderOnb();
}
$('onbNext').onclick = onbNext;
$('onbBack').onclick = onbBack;
async function finishOnb() {
  const go = $('rvGo'); go.disabled = true; go.textContent = t('saving');
  try {
    const expertise = LEVELS[draft.answers[4] == null ? 1 : draft.answers[4]];
    await saveProfile({ display_name: draft.display_name, character: draft.character, language: draft.language, country: draft.country, topics: draft.topics, companies: draft.companies,
      expertise, tone: 'neutral', region: 'global', default_length: draft.default_length, quiz: { answers: draft.answers, scores: scores(draft.answers), at: new Date().toISOString() } });
    today = null; openGen();
  } catch (e) { go.disabled = false; go.textContent = t('startWith', { h: CR(draft.character).name }); $('onbMsg').textContent = t('couldNotSave', { e: e.message }); }
}

// ---- profile page --------------------------------------------------------------------------
let savedTimer = null;
function flashSaved() { $('profSaved').textContent = t('saved'); clearTimeout(savedTimer); savedTimer = setTimeout(() => { $('profSaved').textContent = ''; }, 1600); }
async function profSave(row) { try { await saveProfile(row); flashSaved(); } catch (e) { $('profSaved').textContent = t('couldNotSave', { e: e.message }); } }
let acctTab = 'profile';
function openAccount(tab) {
  acctTab = tab || acctTab;
  show('vProfile');
  seg($('acctTabs'), [['profile', t('tabProfile'), ''], ['library', t('tabLibrary'), '']], acctTab, v => openAccount(v));
  $('profPanel').classList.toggle('hidden', acctTab !== 'profile');
  $('libPanel').classList.toggle('hidden', acctTab !== 'library');
  if (acctTab === 'library') loadLibrary(); else openProfile();
}
function openProfile() {
  const P = profile;
  const c = CR(defaultCrew(P));
  $('profCrew').setAttribute('who', c.id); $('profTile').style.background = c.tile; $('profTile').style.setProperty('--lb-shade', c.shade);
  $('profHostName').textContent = c.name;
  $('profCarWrap').classList.add('hidden');
  seg($('profLang'), langOpts(), P.language || LANG, l => { setLang(l); profSave({ language: l }); openAccount('profile'); });
  countryPicker($('profCountry'), P.country, cc => profSave({ country: cc }));
  $('profName').value = P.display_name || '';
  $('profName').onchange = () => { const v = $('profName').value.trim(); if (v) profSave({ display_name: v }); };
  seg($('profLen'), lenOpts(), P.default_length || 'short', v => profSave({ default_length: v }));
  const fol = P.companies || [];
  $('profFollow').innerHTML = COMPANIES.map(([k, l]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${fol.includes(k)}">${esc(l)}</button>`).join('');
  $('profFollow').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; const cur = [...(profile.companies || [])]; const i = cur.indexOf(b.dataset.k); i < 0 ? cur.push(b.dataset.k) : cur.splice(i, 1); b.setAttribute('aria-pressed', i < 0); profSave({ companies: cur }); };
}
$('hdrProfile').onclick = () => openAccount();
$('profBack').onclick = () => openGen(true);
$('profLogout').onclick = () => logout();
$('profRetake').onclick = () => openOnboarding(profile, 'quiz');
$('profChange').onclick = () => {
  $('profCarWrap').classList.remove('hidden');
  makeCarousel($('profCar'), defaultCrew(profile), id => {
    if (id === profile.character) return;
    const c = CR(id); $('profCrew').setAttribute('who', id); $('profTile').style.background = c.tile; $('profTile').style.setProperty('--lb-shade', c.shade); $('profHostName').textContent = c.name;
    profSave({ character: id });
  });
};

// ---- library: every briefing this user made, newest first (Supabase table + private audio bucket) ----
const BUCKET = 'briefings';
let libRows = [];
function libDate(iso) { try { return new Intl.DateTimeFormat(LANG, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return iso; } }
async function loadLibrary() {
  $('libList').innerHTML = `<p class="hint">${esc(t('libLoading'))}</p>`;
  try {
    libRows = await sb('/rest/v1/briefings?select=id,job_id,created_at,host,language,length_min,question,summary,stories,duration_s,audio_path&order=created_at.desc&limit=100') || [];
  } catch (e) { $('libList').innerHTML = `<p class="msg">${esc(t('libError', { e: e.message }))}</p>`; return; }
  if (!libRows.length) {
    $('libList').innerHTML = `<div class="card libempty"><div id="libDewey"></div><p class="db-t" style="font-size:24px">${esc(t('libEmpty'))}</p><p class="hint">${esc(t('libEmptyHint'))}</p><button class="btn wide" id="libFirst" type="button">${esc(t('firstBrief'))}</button></div>`;
    $('libDewey').innerHTML = dewey('happy', 120); $('libFirst').onclick = () => openGen(true);
    return;
  }
  $('libList').innerHTML = libRows.map((r, i) => {
    const c = CR(r.host);
    const mins = r.duration_s ? fmt(r.duration_s) : (r.length_min || '?') + ' min';
    return `<button type="button" class="libitem" data-i="${i}"><span class="ptile" style="background:${c.tile};--lb-shade:${c.shade}"><lb-crew who="${c.id}" mode="idle"></lb-crew></span>
      <span class="libtext"><b>${esc(c.name)} · ${esc(libDate(r.created_at))}</b><span class="libsum">${esc(r.question || r.summary || '')}</span>
      <span class="score">${esc(mins)} · ${esc(String(r.stories || 0))} ${esc(r.stories === 1 ? t('story1') : t('storyN'))} · ${esc(String(r.language || 'en').toUpperCase())}</span></span>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#0B0B0F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>`;
  }).join('');
}
$('libList').addEventListener('click', async e => {
  const b = e.target.closest('.libitem'); if (!b) return;
  const row = libRows[Number(b.dataset.i)]; if (!row) return;
  b.disabled = true;
  try {
    const full = await sb('/rest/v1/briefings?select=*&id=eq.' + encodeURIComponent(row.id));
    const R = full && full[0] && full[0].result; if (!R) throw new Error('no data');
    fromLibrary = true;
    render(R, row.audio_path ? { path: row.audio_path } : null, !!row.audio_path);
  } catch (err) { b.disabled = false; $('libList').insertAdjacentHTML('afterbegin', `<p class="msg">${esc(t('libError', { e: err.message }))}</p>`); }
});
let fromLibrary = false;
// after a new briefing: store a compact copy + the audio in the user's library
async function saveToLibrary(R, job, blob) {
  if (!session) return;
  try {
    let audio_path = null;
    if (blob) {
      const path = `${session.user_id}/${job}.mp3`;
      const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' }, body: blob });
      if (r.ok) audio_path = path;
    }
    const P = R.profile || {};
    const compact = { transcript: R.transcript || [], profile: { listener_name: P.listener_name, duration_seconds: P.duration_seconds, language: P.language, character: P.character ? { id: P.character.id, name: P.character.name } : null },
      planner: { interpretation: (R.planner || {}).interpretation || null, better_character: (R.planner || {}).better_character || null, short_reason: (R.planner || {}).short_reason || null }, script_checks: { short_note: (R.script_checks || {}).short_note || null } };
    const segsN = new Set((R.transcript || []).map(s => s.story_id).filter(Boolean)).size;
    await sb('/rest/v1/briefings', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { job_id: String(job), host: P.character ? P.character.id : today.character, language: P.language || today.language, length_min: Math.round((P.duration_seconds || 180) / 60),
      question: (today && today.question) || null, summary: compact.planner.interpretation, stories: segsN, duration_s: Number.isFinite(audio.duration) ? Math.round(audio.duration) : null, audio_path, result: compact } });
  } catch (e) { /* the briefing still plays; the library just misses this one */ }
}

// ---- generate page ------------------------------------------------------------------------
let today = null, genCar = null;
function openGen(keep) {
  const P = profile;
  const prev = keep ? today : null;
  today = { length: (prev && prev.length) || P.default_length || 'short', character: (prev && prev.character) || defaultCrew(P), language: (prev && prev.language) || P.language || LANG };
  if (!keep) $('question').value = '';
  $('helloP').textContent = t('hiName', { n: P.display_name });
  show('vGen');
  genCar = makeCarousel($('genCar'), today.character, id => { today.character = id; renderBegin(); });
  renderToday();
}
function renderBegin() {
  const c = CR(today.character);
  $('hostCard').innerHTML = hostCard(c.id);
  $('go').textContent = t('startBrief', { h: c.name });
  $('qHint').textContent = t('qHint', { h: c.name });
}
function renderToday() {
  seg($('lenSeg'), lenOpts(), today.length, v => { today.length = v; });
  seg($('langSeg'), langOpts(), today.language, v => { today.language = v; });
  renderBegin();
}
$('go').onclick = () => start();

// ---- run: the host fills up with REAL progress (stage rows written by the workflow) ----------
const STAGES = [['start', 0.04], ['planning', 0.12], ['reading', 0.3], ['writing', 0.5], ['checking', 0.72], ['recording', 0.84]];
let poll = null, tick = null, t0 = 0, real = 0, shown = 0, stageI = 0;
function stopTimers() { clearInterval(poll); clearInterval(tick); }
function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function renderSteps() {
  const L = tr('stages');
  $('steps').innerHTML = STAGES.map((s, i) => `<li class="${i < stageI ? 'done' : i === stageI ? 'on' : ''}"><span class="dot">${i < stageI ? '✓' : ''}</span>${esc(L[i])}</li>`).join('');
  $('workLabel').textContent = stageI >= STAGES.length ? t('ready') : L[stageI];
}
function animateFill() {
  // the water jumps when a stage really finishes; inside a stage it creeps toward (never past) the next stage
  const nextP = stageI + 1 < STAGES.length ? STAGES[stageI + 1][1] : 0.97;
  const cap = Math.max(real, nextP - 0.02);
  shown = Math.max(shown, real);
  shown += (cap - shown) * 0.012;
  const w = $('workCrew');
  w.setAttribute('level', shown.toFixed(3)); w.setAttribute('progress', shown.toFixed(3));
  $('timer').textContent = fmt((Date.now() - t0) / 1000);
}
function setStage(stage, progress) {
  const i = STAGES.findIndex(s => s[0] === stage);
  if (i > stageI) { stageI = i; renderSteps(); }
  if (typeof progress === 'number' && progress > real) real = progress;
}
async function start() {
  stopTimers();
  const len = today.length, c = CR(today.character);
  $('go').disabled = true;
  real = 0; shown = 0; stageI = 0;
  paintStage($('workStage'), $('workCrew'), c.id);
  $('workCrew').setAttribute('mode', 'making');
  $('workPhase').textContent = t('making');
  $('workT').textContent = t('isMaking', { h: c.name });
  show('vWork'); t0 = Date.now(); renderSteps(); animateFill();
  tick = setInterval(animateFill, 250);
  try {
    const P = profile;
    today.question = $('question').value.trim().slice(0, 400);
    const payload = { profile: { display_name: P.display_name, identity: P.identity, character: P.character || today.character, topics: P.topics, companies: P.companies, expertise: P.expertise, tone: P.tone, region: P.region, country: P.country, language: P.language, default_length: P.default_length },
      today: { length: today.length, character: today.character, language: today.language, question: today.question } };
    const q = new URLSearchParams({ preset: 'account', length: String(MIN[len] * 60), profile: JSON.stringify(payload) });
    const r = await fetch(API('lb-start') + '?' + q.toString());
    if (!r.ok) throw new Error(t('noStart', { s: r.status }));
    const { job_id } = await r.json();
    if (!job_id) throw new Error(t('noJob'));
    poll = setInterval(() => check(job_id), 3000);
  } catch (e) { fail(e.message); }
}
async function check(job) {
  if ((Date.now() - t0) / 1000 > 720) return fail(t('tooLong'));
  try {
    const r = await fetch(API('lb-status') + '?job=' + encodeURIComponent(job));
    if (!r.ok) return;
    const s = await r.json();
    if (s.status === 'running') setStage(s.stage, s.progress);
    else if (s.status === 'done') {
      stopTimers(); $('go').disabled = false;
      stageI = STAGES.length; renderSteps();
      $('workCrew').setAttribute('level', '1'); $('workCrew').setAttribute('progress', '1'); $('workPhase').textContent = t('ready');
      fromLibrary = false;
      setTimeout(async () => { render(s.result, { job }, s.has_audio); const blob = s.has_audio ? await audioReady : null; saveToLibrary(s.result, job, blob); }, 600);
    }
    else if (s.status === 'error') fail(s.error || t('wfError'));
  } catch (e) { /* keep polling */ }
}
function fail(msg) { stopTimers(); $('go').disabled = false; $('errMsg').textContent = msg; show('vErr'); }
$('retry').onclick = () => start();
$('errHome').onclick = () => (profile ? openGen(true) : show('vAuth'));
$('again').onclick = () => { audio.pause(); openGen(true); };
$('toLib').onclick = () => { audio.pause(); openAccount('library'); };

// ---- result -------------------------------------------------------------------------------
const audio = $('audio');
let segs = [], bounds = [], curSeg = 0, useTimes = false;
// segment start in seconds: exact ElevenLabs timestamps when the workflow sent them, else proportional to text length
const segStartSec = i => (useTimes ? segs[i].t : bounds[i] * (Number.isFinite(audio.duration) ? audio.duration : 0));
function segAt(tt) { let i = 0; while (i + 1 < segs.length && segStartSec(i + 1) <= tt + 0.1) i++; return i; }
function srcLinks(seg) { return (seg.sources || []).map(s => `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>${esc(s.publication)} · ${esc(t('openSrc'))}</a>`).join(' '); }
function render(R, src, hasAudio) {
  segs = R.transcript || [];
  const P = R.profile || {};
  const stories = new Set(segs.map(s => s.story_id).filter(Boolean)).size;
  const m = Math.round(P.duration_seconds / 60);
  const host = CR((P.character && P.character.id) || today.character);
  $('pTitle').textContent = t('hostFor', { h: host.name, n: P.listener_name || t('you') });
  $('pMeta').textContent = t('meta', { s: stories, st: stories === 1 ? t('story1') : t('storyN'), m });
  const total = segs.reduce((a, s) => a + s.text.length, 0) || 1;
  let acc = 0; bounds = segs.map(s => { const b = acc; acc += s.text.length / total; return b; });
  useTimes = segs.length > 0 && segs.every(s => typeof s.t === 'number');
  const K = tr('kinds');
  $('tx').innerHTML = segs.map((s, i) => `<li data-i="${i}"><span class="tag">${esc(K[s.kind] || '')}</span><p>${esc(s.text)}</p>${srcLinks(s)}</li>`).join('');
  curSeg = 0; setNow(0);
  $('txCount').textContent = t('lines', { n: segs.length }); $('txCard').open = false;
  $('noAudio').textContent = '';
  $('barFill').style.width = '0';
  if (hasAudio) loadAudio(src);
  else { audio.removeAttribute('src'); $('noAudio').textContent = t('textOnly'); $('tDur').textContent = fmt(P.duration_seconds); }
  $('playCrew').setAttribute('who', host.id); $('playCrew').style.setProperty('--lb-shade', host.shade);
  $('playCard').style.background = host.tile; $('playCard').classList.toggle('dark', !!host.dark);
  document.querySelector('.pctl').style.setProperty('--accent', host.id === 'flo' || host.id === 'brook' ? '#9ED8FA' : host.tile);
  $('playCrew').setAttribute('mode', 'paused'); $('playCrew').setAttribute('level', '1');
  $('playPhase').textContent = host.name.toUpperCase() + ' · ' + host.tag.toUpperCase();
  const C = R.script_checks || {}, PL = R.planner || {};
  $('shortCard').classList.toggle('hidden', !C.short_note);
  $('shortText').innerHTML = C.short_note ? `<b>${esc(t('shorter'))}</b> ${esc(C.short_note)}` : '';
  const better = PL.better_character && PL.better_character !== host.id ? CR(PL.better_character) : null;
  $('tipCard').classList.toggle('hidden', !better);
  if (better) {
    $('tipText').innerHTML = tr('tip').replace(/\{b\}/g, esc(better.name)).replace(/\{t\}/g, esc(better.tag)).replace(/\{q\}/g, esc(better.q)).replace(/\{h\}/g, esc(host.name));
    $('tipGo').textContent = t('askSame', { b: better.name });
    $('tipGo').onclick = () => { audio.pause(); today.character = better.id; openGen(true); };
  }
  $('toLib').classList.toggle('hidden', !fromLibrary);
  show('vResult');
}
// the MP3 is loaded completely first: n8n does not support range requests, so streaming it directly
// gives no duration (Safari) and no seeking (Chrome). A local blob supports both.
let blobUrl = null, audioReady = Promise.resolve(null);
function loadAudio(src) { audioReady = loadAudio2(src); return audioReady; }
async function loadAudio2(src) {
  $('noAudio').textContent = t('loadingAudio');
  $('play').disabled = true;
  try {
    const r = src.path
      ? await fetch(`${SB_URL}/storage/v1/object/authenticated/${BUCKET}/${src.path}`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + session.access_token } })
      : await fetch(API('lb-audio') + '?job=' + encodeURIComponent(src.job));
    if (!r.ok) throw new Error('audio ' + r.status);
    const blob = await r.blob();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([blob], { type: 'audio/mpeg' }));
    audio.src = blobUrl; audio.load();
    $('noAudio').textContent = '';
    // some browsers (Safari) learn the duration without firing an event: check for a few seconds
    let tries = 0; const iv = setInterval(() => { if (Number.isFinite(audio.duration) && audio.duration > 0) { $('tDur').textContent = fmt(audio.duration); clearInterval(iv); } else if (++tries > 60) clearInterval(iv); }, 250);
    $('play').disabled = false;
    return blob;
  } catch (e) { $('noAudio').textContent = t('audioFail'); $('play').disabled = false; return null; }
}
function setNow(i) {
  if (!segs.length) return;
  const s = segs[i];
  $('nowText').textContent = s.text; $('nowSrc').innerHTML = srcLinks(s);
  $('nowPos').textContent = t('partOf', { i: i + 1, n: segs.length });
  for (const li of $('tx').children) li.classList.toggle('cur', Number(li.dataset.i) === i);
}
audio.addEventListener('timeupdate', () => {
  const d = Number.isFinite(audio.duration) ? audio.duration : 0, tt = audio.currentTime;
  $('barFill').style.width = d ? (tt / d * 100) + '%' : '0';
  $('tCur').textContent = fmt(tt); if (d) $('tDur').textContent = fmt(d);
  if (d) $('playCrew').setAttribute('level', Math.max(0, 1 - tt / d).toFixed(3));
  if (d || useTimes) { const i = segAt(tt); if (i !== curSeg) { curSeg = i; setNow(i); } }
});
audio.addEventListener('loadedmetadata', () => { if (Number.isFinite(audio.duration)) $('tDur').textContent = fmt(audio.duration); });
for (const ev of ['durationchange', 'loadeddata', 'canplay', 'canplaythrough']) audio.addEventListener(ev, () => { if (Number.isFinite(audio.duration)) $('tDur').textContent = fmt(audio.duration); });
const setPlaying = on => { $('icoPlay').classList.toggle('hidden', on); $('icoPause').classList.toggle('hidden', !on); $('play').setAttribute('aria-label', on ? 'Pause' : 'Play'); $('playCrew').setAttribute('mode', on ? 'talking' : 'paused'); if (on && Number.isFinite(audio.duration)) $('playCrew').setAttribute('drip-every', (audio.duration / 30).toFixed(1)); };
audio.addEventListener('play', () => setPlaying(true)); audio.addEventListener('pause', () => setPlaying(false)); audio.addEventListener('ended', () => { setPlaying(false); $('playCrew').setAttribute('level', '0'); });
$('play').onclick = () => { if (!audio.src) return; if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
$('back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 10); };
$('next').onclick = () => { if (!Number.isFinite(audio.duration)) return; const i = Math.min(segs.length - 1, curSeg + 1); audio.currentTime = segStartSec(i) + 0.05; };
$('bar').addEventListener('click', e => { if (!Number.isFinite(audio.duration)) return; const r = $('bar').getBoundingClientRect(); audio.currentTime = (e.clientX - r.left) / r.width * audio.duration; });
$('bar').addEventListener('keydown', e => { if (e.key === 'ArrowRight') audio.currentTime += 5; if (e.key === 'ArrowLeft') audio.currentTime -= 5; });
$('tx').addEventListener('click', e => { if (e.target.closest('a')) return; const li = e.target.closest('li[data-i]'); if (!li) return; const i = Number(li.dataset.i); setNow(i); curSeg = i; if (Number.isFinite(audio.duration)) { audio.currentTime = segStartSec(i) + 0.05; audio.play().catch(() => {}); } });

// hero crew says hello once the login screen is visible
setTimeout(() => { const [pip, tide] = document.querySelectorAll('.herocrew lb-crew'); if (REDUCE || !pip || !pip.hello) return; pip.hello(LANG === 'de' ? 'Morgen!' : LANG === 'nl' ? 'Goedemorgen!' : 'Morning!'); setTimeout(() => tide.hello(LANG === 'de' ? 'Fakten zuerst.' : LANG === 'nl' ? 'Feiten eerst.' : 'Facts first.'), 1400); }, 900);
// ---- boot ---------------------------------------------------------------------------------
(async () => {
  applyStatic(); setMode('in'); renderAuthLang();
  if (/^__SUPABASE/.test(SB_URL)) { show('vAuth'); $('authMsg').textContent = 'Supabase is not configured in this build (web/config.json).'; return; }
  const saved = store.get();
  if (saved && saved.access_token) { session = saved; try { await afterLogin(); return; } catch (e) { session = null; store.set(null); } }
  show('vAuth');
})();
}
