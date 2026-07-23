// mirrors the two gates in runReminderSweep
function shouldSend({sent_count, repeat_count, last_sent_at, repeat_interval_days}){
  if(Number(sent_count) >= Number(repeat_count)) return false;
  if(last_sent_at){
    const days=(Date.now()-new Date(last_sent_at).getTime())/864e5;
    if(days < Number(repeat_interval_days)) return false;
  }
  return true;
}
const P=(n,c)=>console.log((c?'PASS':'FAIL')+' '+n);
const ago=d=>new Date(Date.now()-d*864e5);

P('first reminder sends', shouldSend({sent_count:0,repeat_count:2,last_sent_at:null,repeat_interval_days:3})===true);
P('stops at repeat_count', shouldSend({sent_count:2,repeat_count:2,last_sent_at:ago(10),repeat_interval_days:3})===false);
P('beyond repeat_count stops', shouldSend({sent_count:5,repeat_count:2,last_sent_at:ago(30),repeat_interval_days:3})===false);
P('too soon -> skip (1d < 3d)', shouldSend({sent_count:1,repeat_count:3,last_sent_at:ago(1),repeat_interval_days:3})===false);
P('interval elapsed -> send (4d >= 3d)', shouldSend({sent_count:1,repeat_count:3,last_sent_at:ago(4),repeat_interval_days:3})===true);
P('exactly at interval -> send', shouldSend({sent_count:1,repeat_count:3,last_sent_at:ago(3),repeat_interval_days:3})===true);
P('same day never twice', shouldSend({sent_count:1,repeat_count:3,last_sent_at:ago(0),repeat_interval_days:3})===false);

// simulate 30 days: how many reminders does one overdue debt actually get?
let sent=0,last=null;
for(let day=0; day<30; day++){
  const now=Date.now()-(29-day)*864e5;
  const ok = sent<2 && (!last || (now-last)/864e5 >= 3);
  if(ok){ sent++; last=now; }
}
P('30-day sim: exactly repeat_count=2 reminders (not 30)', sent===2);
console.log('   -> reminders sent over 30 days:', sent);
