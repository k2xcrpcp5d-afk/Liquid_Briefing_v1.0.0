// Validator on REAL articles with hand-written claims (quotes located programmatically). Prints only statuses.
const fs=require('fs');
const rows={};for(const f of ['invezz_en','actionforex','ibtimes_uk'])for(const l of fs.readFileSync(`./data/${f}.jsonl`,'utf8').split('\n'))if(l.trim()){const r=JSON.parse(l);rows[r.$id]=r;}
const mk=s=>new Function('$','$input','$execution','require',`return (function(){${s}\n})();`);
const prepSrc=fs.readFileSync('code/01_prepare.js','utf8'), valSrc=fs.readFileSync('code/03_validate_claims.js','utf8');
const span=(t,a,b)=>{const i=t.indexOf(a);const j=t.indexOf(b,i);if(i<0||j<0)throw new Error('span not found: '+a);return t.slice(i,j+b.length);};
const cases={
 'INVZ-10009737-01M7AMS30JH9CG20KPB7WFHP1P':t=>[
  {statement:'US producer prices rose 0.3% in October during the month, the Bureau of Labor Statistics reported.',claim_type:'data_release',evidence_quote:span(t,'rose a seasonally adjusted 0.3%','during the month'),attribution:null,figure:{value:0.3,value_text:'0.3%',unit:'percent',currency:null,period:'October 2026',comparison_basis:'month_over_month',direction:'up',measure:'actual'}},
  {statement:'Economists surveyed by Dow Jones had expected a 0.4% increase during the month.',claim_type:'forecast_or_estimate',evidence_quote:span(t,'rose a seasonally adjusted 0.3%','surveyed by Dow Jones'),attribution:'economists surveyed by Dow Jones',figure:{value:0.4,value_text:'0.4%',unit:'percent',currency:null,period:'October 2026',comparison_basis:'month_over_month',direction:'up',measure:'estimate'}},
  {statement:'The annual headline US producer price rate accelerated to 6.5%.',claim_type:'data_release',evidence_quote:span(t,'the annual headline PPI rate','6.5%'),attribution:null,figure:{value:6.5,value_text:'6.5%',unit:'percent',currency:null,period:'October 2026',comparison_basis:'year_over_year',direction:'up',measure:'actual'}}],
 'ACTI-10010414-01M7AP8WCVYF7JHMQF5AF5PSKQ':t=>[
  {statement:'US producer prices rose 0.3% month-on-month in October.',claim_type:'data_release',evidence_quote:span(t,'US producer prices rose 0.3% mom','in October'),attribution:null,figure:{value:0.3,value_text:'0.3%',unit:'percent',currency:null,period:'October 2026',comparison_basis:'month_over_month',direction:'up',measure:'actual'}},
  {statement:'Annual US producer price inflation accelerated to 6.5% from 6.3%.',claim_type:'data_release',evidence_quote:span(t,'annual PPI inflation accelerated','6.5%'),attribution:null,figure:{value:6.5,value_text:'6.5%',unit:'percent',currency:null,period:'October 2026',comparison_basis:'year_over_year',direction:'up',measure:'actual'}}],
 'INVZ-10009737-01M7HXNFGVTSR4PFBV3VDMT1PA':t=>[
  {statement:'Intel raised $23 billion in an August share offering, which a shareholder lawsuit says came after executives concealed worsening PC demand.',claim_type:'attributed_view',evidence_quote:span(t,'Intel faces a shareholder lawsuit','August share offering'),attribution:'shareholder lawsuit',figure:{value:23,value_text:'$23 billion',unit:'currency_amount',currency:'USD',period:'August 2026',comparison_basis:'level',direction:'none',measure:'actual'}}],
};
for(const [id,fn] of Object.entries(cases)){
  const row=rows[id]; const ps=prepSrc.replace(/const RAW_ROW = \{[\s\S]*?\n\};/,'const RAW_ROW = '+JSON.stringify(row)+';');
  const prep=mk(ps)(null,null,{id:'real'},require);
  const claims=fn(prep[0].json.article.text_content).map((c,i)=>({local_id:'r'+(i+1),...c}));
  const resp={choices:[{finish_reason:'stop',message:{content:JSON.stringify({event:{event_type:'other',primary_entities:[],event_date_or_period:null,one_line_summary:''},claims}),refusal:null}}],usage:{}};
  const out=mk(valSrc)(()=>({first:()=>prep[0]}),{first:()=>({json:resp})},{id:'real'},require)[0].json;
  console.log(prep[0].json.article.publication,'|',prep[0].json.article.author?'author ok':'NO AUTHOR');
  for(const c of out.claims) console.log('  ',c.local_id,c.status,c.errors.join(', '),c.warnings.join(','));
}
