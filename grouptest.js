// Runs 10_ingest_group.js on the real snapshot and scores it against answer_key.json
const fs=require('fs');
const items=[];for(const f of fs.readdirSync('./data'))for(const l of fs.readFileSync('./data/'+f,'utf8').split('\n'))if(l.trim())items.push({json:JSON.parse(l)});
const src=fs.readFileSync('code/10_ingest_group.js','utf8');
const t0=Date.now();
const out=new Function('$input',`return (function(){${src}\n})();`)({all:()=>items,first:()=>items[0]});
const ms=Date.now()-t0;
const stories=out.filter(o=>o.json._type==='story').map(o=>o.json), arts=out.filter(o=>o.json._type==='article').map(o=>o.json), rep=out.find(o=>o.json._type==='report').json;
const A=Object.fromEntries(arts.map(a=>[a.article_id,a]));
const key=JSON.parse(fs.readFileSync('out/answer_key.json','utf8'));
let pass=0,fail=0;const chk=(ok,msg)=>{ok?pass++:fail++;console.log((ok?'  PASS ':'  FAIL ')+msg);};
const sid=id=>A[id].story_id, h=id=>A[id].headline.slice(0,60);
console.log(`runtime ${ms} ms`, JSON.stringify({...rep,ambiguous_pairs_sample:undefined,settings:undefined}));
for(const e of key.events){
  const ind=e.independent; const s0=sid(ind[0]);
  for(const x of ind.slice(1)) chk(sid(x)===s0, `${e.event_id}: "${h(x)}" with "${h(ind[0])}"`);
  for(const [orig,tr] of Object.entries(e.translations_of||{})) for(const t of tr) chk(sid(t)===sid(orig)&&A[t].role==='translation', `${e.event_id}: translation ${t.slice(-8)} linked`);
  const st=stories.find(s=>s.story_id===s0); chk(st && st.independent_outlet_count===new Set(ind.map(i=>A[i].publication)).size, `${e.event_id}: outlet count ${st&&st.independent_outlet_count} (translations not counted)`);
}
const coreIds=key.events.map(e=>sid(e.independent[0]));
chk(new Set(coreIds).size===coreIds.length, 'E1, E2, E3, E3d are four different stories');
for(const m of key.must_stay_separate) chk(!coreIds.includes(sid(m.id)), `separate: "${h(m.id)}"`);
console.log(`\nSCORE ${pass}/${pass+fail}`);
// eyeball: top multi-outlet stories
console.log('\nTOP STORIES');
for(const s of stories.filter(s=>s.kind==='event').slice(0,15)) console.log(`  ${s.editorial_score.toFixed(2)} n=${s.article_ids.length} out=${s.independent_outlet_count} ${s.first_seen.slice(5,13)} ${s.storyline_id||''} | ${s.title.slice(0,70)}`);
const sizes={};for(const s of stories.filter(s=>s.kind==='event')){const n=s.article_ids.length;sizes[n>5?'6+':n]=(sizes[n>5?'6+':n]||0)+1;} console.log('size dist',sizes);
fs.writeFileSync('/tmp/group_out.json',JSON.stringify({stories,report:rep},null,1));
