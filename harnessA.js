// Local run of Workflow A Code nodes: parse -> group -> prepare checks -> (fake LLM) -> apply.  usage: node harnessA.js [llm]
const fs=require('fs');const useLLM=process.argv[2]==='llm';
const outputs={};const $=n=>({all:()=>outputs[n],first:()=>outputs[n][0]});
async function run(name,file,input,patch){let src=fs.readFileSync('code/'+file,'utf8');if(patch)src=patch(src);
  const ctx={helpers:{getBinaryDataBuffer:async(i,k)=>Buffer.from(input[i].binary[k]._raw)}};
  const fn=new Function('$','$input',`return (async function(){${src}\n}).call(this);`);
  outputs[name]=await fn.call(ctx,$,{all:()=>input,first:()=>input[0]});return outputs[name];}
(async()=>{
  const bin={};for(const f of fs.readdirSync('./data'))bin[f.replace('.','_')]={fileName:f,_raw:fs.readFileSync('./data/'+f)};
  const t0=Date.now();
  const parsed=await run('Parse JSONL','09_parse_jsonl.js',[{json:{},binary:bin}]);
  const grouped=await run('Normalize, link & group','10_ingest_group.js',parsed);
  const reqs=await run('Prepare cluster checks','11_prepare_cluster_checks.js',grouped,s=>useLLM?s.replace('USE_LLM_CLUSTER_CHECK: false','USE_LLM_CLUSTER_CHECK: true'):s);
  let resp=reqs;
  if(useLLM&&!reqs[0].json.skip){ // fake model: splits off articles whose headline mentions Trump (exercise split path)
    resp=reqs.map(r=>{const lines=r.json.openai_body.messages[1].content.split('\n');const a=[],b=[];lines.forEach((l,i)=>(/Trump/.test(l)?b:a).push(i+1));
      const groups=[{article_numbers:a,event_label:'main',confidence:'high'}];if(b.length&&a.length)groups.push({article_numbers:b,event_label:'trump',confidence:'medium'});else if(b.length)groups[0].article_numbers=b;
      return {json:{model:'fake',choices:[{message:{content:JSON.stringify({groups})}}],usage:{prompt_tokens:400,completion_tokens:300,prompt_tokens_details:{cached_tokens:300}}}};});
  }
  const rows=await run('Apply checks & build rows','13_apply_checks_and_rows.js',resp);
  const rep=rows.find(r=>r.json._type==='report').json;
  console.log(`runtime ${Date.now()-t0} ms | requests ${reqs[0].json.skip?0:reqs.length}`, JSON.stringify({cluster_check:rep.cluster_check,final_stories:rep.final_stories,multi_outlet:rep.final_multi_outlet_stories,rows:rep.rows,files:rep.grouping.files}));
  // answer key on final rows
  const S=rows.filter(r=>r.json._type==='article_row').map(r=>r.json);const sid=Object.fromEntries(S.map(a=>[a.article_id,a.story_id]));
  const key=JSON.parse(fs.readFileSync('out/answer_key.json'));let p=0,f=0;
  for(const e of key.events){const s0=sid[e.independent[0]];for(const x of e.independent.slice(1))(sid[x]===s0?p++:(f++,console.log('FAIL link',e.event_id,x)));for(const tr of Object.values(e.translations_of||{}))for(const t of tr)(sid[t]===s0?p++:(f++,console.log('FAIL translation',t)));}
  const core=key.events.map(e=>sid[e.independent[0]]);(new Set(core).size===core.length?p++:(f++,console.log('FAIL core distinct')));
  for(const m of key.must_stay_separate)(!core.includes(sid[m.id])?p++:(f++,console.log('FAIL separate',m.id)));
  console.log(`ANSWER KEY ${p}/${p+f}`);
  // row sanity: no arrays/objects for Data Tables
  const badCols=new Set();for(const r of rows)if(r.json._type!=='report')for(const [k,v] of Object.entries(r.json))if(v!==null&&typeof v==='object')badCols.add(k);
  console.log('non-scalar columns:',[...badCols]);
  fs.writeFileSync('/tmp/rowsA.json',JSON.stringify(rows.map(r=>r.json).filter(r=>r._type!=='article_row')));
})();
