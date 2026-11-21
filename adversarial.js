const fs=require('fs');
const prepSrc=fs.readFileSync('code/01_prepare.js','utf8');
const valSrc=fs.readFileSync('code/03_validate_claims.js','utf8');
const mk=(src)=>new Function('$','$input','$execution','require',`return (function(){${src}\n})();`);
const prep=mk(prepSrc)(null,null,{id:'adv'},require);
const base={statement:'',claim_type:'data_release',evidence_quote:'Producer prices in Norland rose 0.4% in October from the previous month, the Norland Statistics Office said on Thursday',attribution:null,figure:{value:0.4,value_text:'0.4%',unit:'percent',currency:null,period:'October 2026',comparison_basis:'month_over_month',direction:'up',measure:'actual'}};
const fx={statement:'',claim_type:'price_move',evidence_quote:'By 15:00 local time the krone was up 0.5% against the euro, trading at 11.42 krone per euro.',attribution:null,figure:{value:0.5,value_text:'0.5%',unit:'percent',currency:null,period:null,comparison_basis:'intraday',direction:'up',measure:'actual'}};
const cases=[
 ['wrong number', {...base,statement:'Norland producer prices rose 0.5% in October from the previous month.'}],
 ['wrong direction', {...base,statement:'Norland producer prices fell 0.4% in October from the previous month.'}],
 ['wrong month', {...base,statement:'Norland producer prices rose 0.4% in September from the previous month.'}],
 ['pp instead of %', {...base,statement:'Norland producer prices rose 0.4 percentage points in October from the previous month.'}],
 ['estimate as actual', {...base,statement:'Norland producer prices rose 0.2% from the previous month.',evidence_quote:'faster than the 0.2% increase economists polled by Fictional Markets Wire had expected',figure:{...base.figure,value:0.2,value_text:'0.2%',measure:'estimate'},claim_type:'forecast_or_estimate',attribution:'economists polled by Fictional Markets Wire'}],
 ['invented cause', {...fx,statement:'By 15:00 local time, the Norland krone was up 0.5% against the euro because of the data.'}],
 ['intraday as close', {...fx,statement:'The Norland krone closed up 0.5% against the euro by 15:00 local time.'}],
 ['qualifier dropped', {...fx,statement:'The Norland krone was up 0.5% against the euro.'}],
 ['OK control', {...base,statement:'Norland producer prices rose 0.4% in October from the previous month.'}],
];
for(const [name,c] of cases){
  const resp={choices:[{finish_reason:'stop',message:{content:JSON.stringify({event:{event_type:'other',primary_entities:[],event_date_or_period:null,one_line_summary:''},claims:[{local_id:'x',...c}]}),refusal:null}}],usage:{}};
  const $=n=>({first:()=>prep[0]});
  const out=mk(valSrc)($,{first:()=>({json:resp})},{id:'adv'},require)[0].json.claims[0];
  console.log(name.padEnd(20), out.status.padEnd(9), out.errors.join(', '));
}
