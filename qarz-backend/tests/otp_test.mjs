import { newDb } from 'pg-mem';
import crypto from 'crypto';

const db = newDb();
db.public.registerFunction({ name:'gen_random_uuid', returns:'uuid', impure:true,
  implementation: () => crypto.randomUUID() });
db.public.registerFunction({ name:'now', returns:'timestamptz', impure:true,
  implementation: () => new Date() });

db.public.none(`
CREATE TABLE otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code_hash TEXT NOT NULL,
  purpose VARCHAR(40) NOT NULL DEFAULT 'telegram_link',
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

const SECRET='test-secret';
const hashCode=(p,c)=>crypto.createHmac('sha256',SECRET).update(`${p}:${c}`).digest('hex');
const gen=()=>String(crypto.randomInt(0,1_000_000)).padStart(6,'0');
const q=(s,p)=>db.public.query(s.replace(/\$(\d+)/g,(_,i)=>{
  const v=p[i-1];
  if(v===null||v===undefined) return 'NULL';
  if(v instanceof Date) return `'${v.toISOString()}'`;
  return typeof v==='number'?v:`'${String(v).replace(/'/g,"''")}'`;
}));

const MAX=5, TTL=5;
async function issue(phone){
  const code=gen(), h=hashCode(phone,code);
  const exp=new Date(Date.now()+TTL*60000);
  q(`UPDATE otp_codes SET consumed_at=now() WHERE phone=$1 AND purpose=$2 AND consumed_at IS NULL`,[phone,'telegram_link']);
  q(`INSERT INTO otp_codes (phone,code_hash,purpose,expires_at) VALUES ($1,$2,$3,$4)`,[phone,h,'telegram_link',exp]);
  return code;
}
async function verify(phone,code){
  const r=q(`SELECT * FROM otp_codes WHERE phone=$1 AND purpose=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,[phone,'telegram_link']).rows[0];
  if(!r) throw new Error('OTP_NOT_FOUND');
  if(new Date(r.expires_at)<new Date()){ q(`UPDATE otp_codes SET consumed_at=now() WHERE id=$1`,[r.id]); throw new Error('OTP_EXPIRED'); }
  if(r.attempts>=MAX){ q(`UPDATE otp_codes SET consumed_at=now() WHERE id=$1`,[r.id]); throw new Error('OTP_LOCKED'); }
  const exp=hashCode(phone,String(code));
  const a=Buffer.from(r.code_hash,'utf8'), b=Buffer.from(exp,'utf8');
  if(!(a.length===b.length&&crypto.timingSafeEqual(a,b))){
    q(`UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1`,[r.id]);
    throw new Error('OTP_INVALID');
  }
  q(`UPDATE otp_codes SET consumed_at=now() WHERE id=$1`,[r.id]);
  return true;
}
const P=(n,c)=>console.log((c?'PASS':'FAIL')+' '+n);
const phone='+998901234567';

// 1 happy path
let code=await issue(phone);
P('correct code verifies', await verify(phone,code).catch(()=>false)===true);

// 2 replay blocked
let replay=false; try{ await verify(phone,code); replay=true; }catch(e){ replay=e.message; }
P('replay rejected (OTP_NOT_FOUND)', replay==='OTP_NOT_FOUND');

// 3 wrong code
code=await issue(phone);
let wrong=''; try{ await verify(phone,'000000'); }catch(e){ wrong=e.message; }
P('wrong code rejected', wrong==='OTP_INVALID'||wrong==='OTP_NOT_FOUND');

// 4 lockout after 5 attempts
code=await issue(phone);
let last='';
for(let i=0;i<6;i++){ try{ await verify(phone,'111111'); }catch(e){ last=e.message; } }
P('locks out after max attempts', last==='OTP_LOCKED');

// 5 correct code refused once locked
let afterLock=''; try{ await verify(phone,code); }catch(e){ afterLock=e.message; }
P('correct code refused after lockout', afterLock!=='' );

// 6 reissue invalidates old
const old=await issue(phone); const fresh=await issue(phone);
let oldRes=''; try{ await verify(phone,old); }catch(e){ oldRes=e.message; }
P('old code invalidated by reissue', oldRes==='OTP_INVALID');
P('newest code still works', await verify(phone,fresh).catch(()=>false)===true);

// 7 never plaintext
await issue(phone);
const row=q(`SELECT code_hash FROM otp_codes WHERE phone=$1 ORDER BY created_at DESC LIMIT 1`,[phone]).rows[0];
P('code stored hashed (64 hex, not 6 digits)', /^[a-f0-9]{64}$/.test(row.code_hash));
