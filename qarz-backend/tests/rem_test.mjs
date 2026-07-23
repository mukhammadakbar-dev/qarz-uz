const P=(n,c,x='')=>console.log((c?'PASS':'FAIL')+' '+n+(x?' :: '+x:''));
const { default: pgMod } = await import('pg');
let candidates=[], sentLog=[];
pgMod.Pool.prototype.query = async (t,p) => {
  const s=String(t);
  if (s.includes('FROM debts dt')) return {rows:candidates};
  if (s.includes("created_at::date = CURRENT_DATE")) return {rows:[]};
  if (s.includes('INSERT INTO notifications')) { sentLog.push(p); return {rows:[{id:'n1'}]}; }
  if (s.includes('FROM payment_links')) return {rows:[]};
  if (s.includes('SELECT * FROM debts WHERE id')) return {rows:[{id:p?.[0],amount:100000,paid_amount:0,status:'open'}]};
  if (s.includes('sms_balance')) return {rows:[{remaining:10,extra_package:0}]};
  return {rows:[]};
};
pgMod.Pool.prototype.connect = async () => ({query:pgMod.Pool.prototype.query, release(){}});

const { runReminderSweep } = await import('../src/services/scheduler.service.js');
const mkDebt = (o={}) => ({debt_id:'d1',amount:100000,paid_amount:0,due_date:new Date(),debtor_id:'x1',
  full_name:'Ali',phone:'+998901234567',telegram_id:null,shop_id:'s1',days_before:1,
  repeat_count:2,repeat_interval_days:3,template:'{name} {amount} {due} {link}',
  sent_count:0,last_sent_at:null,...o});

// 1) never sent -> sends
candidates=[mkDebt()]; sentLog=[];
await runReminderSweep();
P('first reminder sends', sentLog.length===1, `sent=${sentLog.length}`);

// 2) repeat_count reached -> stops
candidates=[mkDebt({sent_count:2, repeat_count:2})]; sentLog=[];
await runReminderSweep();
P('stops at repeat_count', sentLog.length===0, `sent=${sentLog.length}`);

// 3) over repeat_count -> stops
candidates=[mkDebt({sent_count:5, repeat_count:2})]; sentLog=[];
await runReminderSweep();
P('stops beyond repeat_count', sentLog.length===0);

// 4) interval not elapsed -> skips (sent 1 day ago, interval 3)
candidates=[mkDebt({sent_count:1, last_sent_at:new Date(Date.now()-1*864e5)})]; sentLog=[];
await runReminderSweep();
P('skips before interval elapses', sentLog.length===0, `sent=${sentLog.length}`);

// 5) interval elapsed -> sends (sent 4 days ago, interval 3)
candidates=[mkDebt({sent_count:1, last_sent_at:new Date(Date.now()-4*864e5)})]; sentLog=[];
await runReminderSweep();
P('sends after interval elapses', sentLog.length===1, `sent=${sentLog.length}`);

// 6) exactly at interval boundary -> sends
candidates=[mkDebt({sent_count:1, last_sent_at:new Date(Date.now()-3.01*864e5)})]; sentLog=[];
await runReminderSweep();
P('sends at interval boundary', sentLog.length===1);

// 7) custom repeat_count=5 keeps going
candidates=[mkDebt({sent_count:3, repeat_count:5, last_sent_at:new Date(Date.now()-5*864e5)})]; sentLog=[];
await runReminderSweep();
P('honours higher repeat_count', sentLog.length===1);
