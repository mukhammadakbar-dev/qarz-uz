const { sessions } = await import('./src/lib/sessions.js');
const { api } = await import('./src/lib/api.js');
const TG=555002;
globalThis.fetch = async (url, opts={}) => {
  const path=String(url).replace(/^https?:\/\/[^/]+/,'');
  const json=(o,status=200)=>({ok:status<400,status,text:async()=>JSON.stringify(o)});
  console.log('  fetch:', path, 'auth=', (opts.headers?.Authorization||'').slice(0,20));
  if (path==='/api/auth/refresh') { console.log('   -> returning 401 for refresh'); return json({error:{message:'bad refresh'}},401); }
  return json({error:{message:'expired'}},401);
};
sessions.set(TG,{accessToken:'OLD',refreshToken:'R1'});
try {
  const r = await api.dashboard(TG);
  console.log('RESULT (no throw!):', JSON.stringify(r));
} catch(e) {
  console.log('THREW:', e.code, e.message);
}
console.log('session after:', JSON.stringify(sessions.get(TG)));
sessions.clear(TG);
