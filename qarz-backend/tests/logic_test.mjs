const P=(n,c,x='')=>console.log((c?'PASS':'FAIL')+' '+n+(x?' :: '+x:''));
console.log('--- #2 enforceSubscription ---');
const { default: pgMod } = await import('pg');
let subRow = null;
pgMod.Pool.prototype.query = async (t) => {
  if (String(t).includes('FROM subscriptions')) return { rows: subRow?[subRow]:[] };
  return { rows: [] };
};
const { enforceSubscription } = await import('../src/middleware/subscription.js');
const run = (user, method) => new Promise(res => {
  enforceSubscription({user, method}, {}, (e)=>res(e?e.code:'NEXT'));
});
const future = new Date(Date.now()+864e5), past = new Date(Date.now()-864e5);

subRow = { status:'active', ends_at: future };
P('active sub allows POST', await run({role:'shop_owner',shopId:'s1'},'POST')==='NEXT');
subRow = { status:'trial', ends_at: past };
P('expired trial blocks POST', await run({role:'shop_owner',shopId:'s1'},'POST')==='SUBSCRIPTION_EXPIRED');
P('expired trial ALLOWS GET (view-only)', await run({role:'shop_owner',shopId:'s1'},'GET')==='NEXT');
P('expired blocks DELETE', await run({role:'staff',shopId:'s1'},'DELETE')==='SUBSCRIPTION_EXPIRED');
subRow = null;
P('no subscription row blocks POST', await run({role:'shop_owner',shopId:'s1'},'POST')==='SUBSCRIPTION_EXPIRED');
subRow = { status:'active', ends_at: past };
P('active-but-past-end blocks POST', await run({role:'shop_owner',shopId:'s1'},'POST')==='SUBSCRIPTION_EXPIRED');
subRow = { status:'blocked', ends_at: future };
P('blocked status blocks POST', await run({role:'shop_owner',shopId:'s1'},'POST')==='SUBSCRIPTION_EXPIRED');
// personal users unaffected
P('personal user never gated', await run({role:'personal',id:'u1'},'POST')==='NEXT');
P('super_admin never gated', await run({role:'super_admin'},'POST')==='NEXT');

console.log('\n--- #3 plan limits ---');
let planRow=null, countRow={c:0};
pgMod.Pool.prototype.query = async (t) => {
  const s=String(t);
  if (s.includes('FROM subscriptions')&&s.includes('JOIN plans')) return {rows: planRow?[planRow]:[]};
  if (s.includes('COUNT(*)')) return {rows:[countRow]};
  return {rows:[]};
};
const { assertDebtorQuota, assertStaffQuota } = await import('../src/services/plan.service.js');
const tryQ = async (fn) => { try { await fn('s1'); return 'OK'; } catch(e){ return e.code; } };
planRow={name:'Start',max_debtors:50,max_staff:0}; countRow={c:49};
P('under limit passes', await tryQ(assertDebtorQuota)==='OK');
countRow={c:50};
P('at limit blocks', await tryQ(assertDebtorQuota)==='PLAN_LIMIT_REACHED');
countRow={c:99};
P('over limit blocks', await tryQ(assertDebtorQuota)==='PLAN_LIMIT_REACHED');
planRow={name:'Business',max_debtors:null,max_staff:10}; countRow={c:99999};
P('null max_debtors = unlimited', await tryQ(assertDebtorQuota)==='OK');
planRow={name:'Start',max_debtors:50,max_staff:0}; countRow={c:0};
P('max_staff=0 blocks staff', await tryQ(assertStaffQuota)==='PLAN_LIMIT_REACHED');
planRow={name:'Pro',max_debtors:500,max_staff:2}; countRow={c:1};
P('staff under limit passes', await tryQ(assertStaffQuota)==='OK');
countRow={c:2};
P('staff at limit blocks', await tryQ(assertStaffQuota)==='PLAN_LIMIT_REACHED');
