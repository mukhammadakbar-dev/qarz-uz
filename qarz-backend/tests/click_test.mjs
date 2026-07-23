import crypto from 'crypto';
const SECRET='clicksecret';
const CLICK_OK=0, SIGN_FAIL=-1, BAD_AMOUNT=-2, ALREADY_PAID=-4, NOT_FOUND=-6;

// in-memory stand-ins
let links=[{id:'L1',token:'tok1',debt_id:'D1',amount:50000,status:'active',expires_at:new Date(Date.now()+3600e3)}];
let payments=[];

const sign=(p)=>{const base=`${p.click_trans_id}${p.service_id}${SECRET}${p.merchant_trans_id}${p.merchant_prepare_id??''}${p.amount}${p.action}${p.sign_time}`;
  return crypto.createHash('md5').update(base).digest('hex');};
const verifySig=(p)=>sign(p)===p.sign_string;

// mirrors controller logic
function complete(p){
  if(!verifySig(p)) return {error:SIGN_FAIL};
  const link=links.find(l=>l.token===p.merchant_trans_id);
  if(!link) return {error:NOT_FOUND};
  const dup=payments.find(x=>x.debt_id===link.debt_id&&x.transaction_id===String(p.click_trans_id)&&x.method==='click');
  if(link.status==='used'&&dup) return {error:ALREADY_PAID, merchant_confirm_id:link.id};
  if(Number(p.error)!==0) return {error:p.error};
  if(Math.abs(Number(p.amount)-Number(link.amount))>0.01) return {error:BAD_AMOUNT};
  if(link.status==='expired'||new Date(link.expires_at)<new Date()) return {error:NOT_FOUND};
  payments.push({debt_id:link.debt_id,transaction_id:String(p.click_trans_id),method:'click',amount:Number(p.amount)});
  link.status='used';
  return {error:CLICK_OK, merchant_confirm_id:link.id};
}
const mk=(o={})=>{const p={click_trans_id:'999',service_id:'svc',merchant_trans_id:'tok1',amount:50000,action:'1',sign_time:'2026-07-22 10:00:00',error:0,...o};p.sign_string=sign(p);return p;};
const P=(n,c)=>console.log((c?'PASS':'FAIL')+' '+n);

// 1 first complete succeeds
let r=complete(mk());
P('first Complete -> 0 (success)', r.error===CLICK_OK);
P('payment recorded once', payments.length===1);

// 2 RETRY: same trans id again -> ALREADY_PAID (the bug being fixed)
r=complete(mk());
P('retry Complete -> -4 ALREADY_PAID (not -6)', r.error===ALREADY_PAID);
P('retry did NOT double-charge', payments.length===1);
P('retry returns merchant_confirm_id', r.merchant_confirm_id==='L1');

// 3 unknown token
r=complete(mk({merchant_trans_id:'nope'}));
P('unknown token -> -6', r.error===NOT_FOUND);

// 4 bad signature
let bad=mk(); bad.sign_string='tampered';
P('tampered signature -> -1', complete(bad).error===SIGN_FAIL);

// 5 wrong amount
links.push({id:'L2',token:'tok2',debt_id:'D2',amount:70000,status:'active',expires_at:new Date(Date.now()+3600e3)});
r=complete(mk({merchant_trans_id:'tok2',amount:100}));
P('wrong amount -> -2', r.error===BAD_AMOUNT);

// 6 expired link
links.push({id:'L3',token:'tok3',debt_id:'D3',amount:1000,status:'active',expires_at:new Date(Date.now()-1000)});
r=complete(mk({merchant_trans_id:'tok3',amount:1000}));
P('expired link -> -6', r.error===NOT_FOUND);

// 7 failed payment passthrough
links.push({id:'L4',token:'tok4',debt_id:'D4',amount:1000,status:'active',expires_at:new Date(Date.now()+3600e3)});
r=complete(mk({merchant_trans_id:'tok4',amount:1000,error:-5017}));
P('user-failed payment passes error through', r.error===-5017);
P('no payment recorded for failure/expired/bad-amount', payments.length===1);

console.log('\n--- payment ledger dump ---');
payments.forEach(p=>console.log(JSON.stringify(p)));
console.log('total payments:', payments.length);
