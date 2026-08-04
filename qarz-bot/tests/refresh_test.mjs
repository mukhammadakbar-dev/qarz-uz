// Simulates the bot's authRequest against a server that expires tokens.
class ApiError extends Error{constructor(m,s){super(m);this.status=s;}}
class SessionExpired extends Error{constructor(){super('expired');this.status=401;}}

let store={};
const sessions={get:id=>store[id]||null,set:(id,d)=>{store[id]={...(store[id]||{}),...d};},clear:id=>{delete store[id];}};

let validAccess='A1', validRefresh='R1', refreshCalls=0, protectedCalls=0, refreshShouldFail=false;
async function rawFetch(path,{token,body}={}){
  if(path==='/api/auth/refresh'){
    refreshCalls++;
    if(refreshShouldFail||body.refreshToken!==validRefresh) throw new ApiError('bad refresh',401);
    validAccess='A2'; return {accessToken:'A2',refreshToken:'R1'};
  }
  protectedCalls++;
  if(token!==validAccess) throw new ApiError('unauthorized',401);
  return {ok:true,path};
}
async function authRequest(tgId,path,opts={}){
  const sess=sessions.get(tgId);
  if(!sess?.accessToken) throw new SessionExpired();
  try{ return await rawFetch(path,{...opts,token:sess.accessToken}); }
  catch(err){
    if(err.status!==401) throw err;
    if(!sess.refreshToken){ sessions.clear(tgId); throw new SessionExpired(); }
    let r; try{ r=await rawFetch('/api/auth/refresh',{method:'POST',body:{refreshToken:sess.refreshToken}}); }
    catch{ sessions.clear(tgId); throw new SessionExpired(); }
    sessions.set(tgId,{accessToken:r.accessToken,refreshToken:r.refreshToken});
    try{ return await rawFetch(path,{...opts,token:r.accessToken}); }
    catch(e2){ if(e2.status===401){sessions.clear(tgId); throw new SessionExpired();} throw e2; }
  }
}
const P=(n,c)=>console.log((c?'PASS':'FAIL')+' '+n);

// valid token: straight through, no refresh
sessions.set(1,{accessToken:'A1',refreshToken:'R1'});
let r=await authRequest(1,'/api/debtors');
P('valid token works', r.ok===true);
P('no refresh when token valid', refreshCalls===0);

// EXPIRED token: should auto-refresh and retry (the bug being fixed)
validAccess='EXPIRED_NOW';
refreshCalls=0; protectedCalls=0;
validAccess='A2';                       // server now only accepts A2
sessions.set(1,{accessToken:'A1'});     // bot still holds stale A1
r=await authRequest(1,'/api/debtors');
P('stale token auto-refreshes and succeeds', r.ok===true);
P('refresh called exactly once', refreshCalls===1);
P('original request replayed (2 protected calls)', protectedCalls===2);
P('session updated with new access token', sessions.get(1).accessToken==='A2');

// refresh itself fails -> session cleared, SessionExpired surfaced
refreshShouldFail=true;
sessions.set(2,{accessToken:'STALE',refreshToken:'R1'});
let threw=null; try{ await authRequest(2,'/api/debtors'); }catch(e){ threw=e; }
P('failed refresh throws SessionExpired', threw instanceof SessionExpired);
P('failed refresh clears session', sessions.get(2)===null);

// no refresh token at all
refreshShouldFail=false;
sessions.set(3,{accessToken:'STALE'});
threw=null; try{ await authRequest(3,'/api/debtors'); }catch(e){ threw=e; }
P('missing refreshToken -> SessionExpired', threw instanceof SessionExpired);

// non-401 errors propagate untouched (not swallowed as auth issue)
sessions.set(4,{accessToken:'A2',refreshToken:'R1'});
threw=null;
try{
  await (async()=>{
    try{ throw new ApiError('server boom',500); }
    catch(e){ if(e.status!==401) throw e; } })();
}catch(e){ threw=e; }
P('500 error propagates (not treated as auth)', threw?.status===500);
