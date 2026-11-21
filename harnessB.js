// Local run of Workflow B Code nodes on real data (A output) with a FAKE extractor. usage: node harnessB.js '<about you>' [preset] [length]
const fs=require('fs');
const about=process.argv[2]||'', preset=process.argv[3]||'custom (use my text)', length=process.argv[4]||'auto';
const outputs={};const $=n=>{if(!outputs[n])throw new Error('no output '+n);return {all:()=>outputs[n],first:()=>outputs[n][0]};};
const helpers={getBinaryDataBuffer:async()=>Buffer.alloc(10),prepareBinaryData:async(buf,fileName,mimeType)=>({data:buf.toString('base64'),fileName,mimeType,_buf:buf})};
async function run(name,file,input){const src=fs.readFileSync('code/'+file,'utf8');const fn=new Function('$','$input','$execution',`return (async function(){${src}\n}).call(this);`);
  outputs[name]=await fn.call({helpers},$,{all:()=>input,first:()=>input[0]},{id:'local'});return outputs[name];}
// fake extractor: up to 5 sentences with a number from the article text, statement = sentence (verbatim)
function fakeExtract(body){const t=body.messages[1].content.split('<<<ARTICLE TEXT>>>\n')[1].split('\n<<<END')[0];
  const sents=(t.match(/[^.!?]+(?:\.\d+[^.!?]*)*[.!?]/g)||[]).map(s=>s.trim()).filter(s=>s.length>40&&s.length<260).slice(0,6);
  const claims=sents.map((s,i)=>({local_id:'c'+(i+1),statement:s,claim_type:'other_fact',evidence_quote:s,attribution:null,figure:null}));
  return {model:'fake-extractor',choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims}),refusal:null}}],usage:{prompt_tokens:2300,completion_tokens:1100,prompt_tokens_details:{cached_tokens:1024}}};}
(async()=>{
  // Workflow A output (rules only) as Data Table rows
  const items=[];for(const f of fs.readdirSync('./data'))for(const l of fs.readFileSync('./data/'+f,'utf8').split('\n'))if(l.trim())items.push({json:JSON.parse(l)});
  await run('Normalize, link & group','10_ingest_group.js',items);
  await run('Prepare cluster checks','11_prepare_cluster_checks.js',outputs['Normalize, link & group']);
  const rows=await run('Apply checks & build rows','13_apply_checks_and_rows.js',outputs['Prepare cluster checks']);
  const strip=t=>rows.filter(r=>r.json._type===t).map(r=>{const {_type,...x}=r.json;return {json:x};});
  const cachePath='/tmp/lb_claims_cache.json'; const cache=fs.existsSync(cachePath)?JSON.parse(fs.readFileSync(cachePath)):[];
  outputs['Get stories']=strip('story_row'); outputs['Get articles']=strip('article_row'); outputs['Get claim cache']=cache.length?cache.map(j=>({json:j})):[{json:{}}];
  const t0=Date.now();
  await run('Build profile','20_build_profile.js',[{json:{'About you':about,'Preset':preset,'Length':length}}]);
  await run('Finalize profile','21_finalize_profile.js',outputs['Build profile']);
  await run('Select stories','22_select_stories.js',outputs['Finalize profile']);
  const reqs=await run('Build extraction requests','23_extraction_requests.built.js',outputs['Select stories']);
  const resp=reqs[0].json.skip?reqs:reqs.map(r=>({json:fakeExtract(r.json.openai_body)}));
  const val=await run('Validate claims (batch)','24_validate_batch.built.js',resp);
  const fresh=val.filter(v=>!v.json._none).map(v=>v.json); fs.writeFileSync(cachePath,JSON.stringify([...cache,...fresh]));
  const ereq=await run('Build editor request','29_editor_request.js',val);
  let eresp=ereq;
  if(ereq[0].json.use_editor){const c=ereq[0].json.candidates;const plan={arc:'fake arc',stories:[{story_id:c[0].story_id,role:'main',angle:'main angle',claim_ids:c[0].claims.slice(0,4).map(x=>x.claim_id),words:120},...(c[1]?[{story_id:c[1].story_id,role:'quick_hit',angle:'hit',claim_ids:[c[1].claims[0].claim_id],words:20}]:[])],cut:c.slice(2).map(x=>({story_id:x.story_id,why:'not enough time'}))};
    eresp=[{json:{model:'fake-editor',choices:[{message:{content:JSON.stringify(plan)}}],usage:{prompt_tokens:3000,completion_tokens:700}}}];}
  const wreq=await run('Build writer request','27_writer_request.js',eresp);
  let wresp=wreq;
  if(wreq[0].json.use_writer){const st=wreq[0].json.stories;const m=st[0].claims;const segs=[{kind:'hook',text:m[0].statement,claim_ids:[m[0].claim_id],story_id:st[0].story_id},{kind:'teaser',text:'Today: the main story and one quick hit.',claim_ids:[],story_id:null},{kind:'question',text:'Is that a lot?',claim_ids:[],story_id:null}];
    for(const c of m.slice(1))segs.push({kind:'story',text:c.statement,claim_ids:[c.claim_id],story_id:st[0].story_id});
    segs.push({kind:'context',text:'That is the biggest number in 37 years.',claim_ids:[m[0].claim_id],story_id:st[0].story_id});
    if(st[1])segs.push({kind:'quick_hit',text:st[1].claims[0].statement,claim_ids:[st[1].claims[0].claim_id],story_id:st[1].story_id});
    segs.push({kind:'closer',text:'That is the story to watch.',claim_ids:[],story_id:null});
    wresp=[{json:{model:'fake-writer',choices:[{finish_reason:'stop',message:{content:JSON.stringify({segments:segs})}}],usage:{prompt_tokens:1800,completion_tokens:900}}}];}
  const vreq=await run('Check script & build verifier request','28_verifier_request.built.js',wresp);
  let vresp=vreq;
  if(!vreq[0].json.skip_verifier){const segs=vreq[0].json.segments; vresp=[{json:{model:'fake-verifier',choices:[{message:{content:JSON.stringify({verdicts:segs.map((x,i)=>({index:x.index,supported:i!==1,problem:i===1?'adds a detail not in the claim (test)':''}))})}}],usage:{prompt_tokens:900,completion_tokens:200}}}];}
  let g;try{g=await run('Build script & gate','25_script_gate.built.js',vresp);}catch(e){console.log('GATE:',e.message.split('\nREPORT')[0]);return;}
  console.log('script_checks',JSON.stringify(g[0].json.script_checks));console.log('editor',JSON.stringify(g[0].json.editor));
  const pk=await run('Package briefing page','26_package_page.js',g);
  const j=pk[0].json; const S=outputs['Select stories'][0].json;
  console.log(`profile ${JSON.stringify(j.profile)}\ntrace ${j.profile_trace.map(t=>t.field+'='+t.value+' <- '+t.because).join(' | ')}`);
  console.log(`selected ${S.plan.selected.length}/${S.plan.candidates}: `+S.plan.selected.map(s=>`#${s.rank} ${s.title.slice(0,55)} [${s.score}]`).join(' || '));
  console.log('excluded', JSON.stringify(S.plan.excluded));
  console.log(`extract new=${S.to_extract.length} cached=${S.cached.length} | dropped=${j.decisions.dropped_stories.length} | ${g[0].json.script.words} words ~${g[0].json.script.est_duration_seconds}s | voice ${g[0].json.tts.voice_name} speed ${g[0].json.tts.body.voice_settings.speed} | ${Date.now()-t0} ms`);
  console.log('--- script ---\n'+g[0].json.script.tts_text.slice(0,1400));
  fs.writeFileSync('/tmp/briefing_page.html',pk[0].binary.briefing_page._buf);
})();
