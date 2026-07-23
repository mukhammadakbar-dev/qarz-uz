import { z } from 'zod';
const schema = z.object({
  name: z.string().optional(),
  priceUzs: z.number().nonnegative().optional(),
  maxDebtors: z.number().int().nullable().optional(),
  maxStaff: z.number().int().optional(),
  monthlySms: z.number().int().optional(),
  advancedStats: z.boolean().optional(),
});
function build(b){
  const has=k=>Object.prototype.hasOwnProperty.call(b,k);
  const map=[['name','name'],['priceUzs','price_uzs'],['maxDebtors','max_debtors'],['maxStaff','max_staff'],['monthlySms','monthly_sms'],['advancedStats','advanced_stats']];
  const sets=[],params=['start'];
  for(const [k,c] of map) if(has(k)){params.push(b[k]);sets.push(`${c} = $${params.length}`);}
  return {sql:sets.length?`UPDATE plans SET ${sets.join(', ')}, updated_at = now() WHERE code = $1`:null, params};
}
const P=(n,c)=>console.log((c?'PASS':'FAIL')+' '+n);

// THE BUG: setting max_debtors to null (unlimited) used to be impossible with COALESCE
let parsed=schema.safeParse({maxDebtors:null});
P('zod accepts maxDebtors: null', parsed.success);
let r=build(parsed.data);
P('null IS included in SET clause', r.sql.includes('max_debtors = $2'));
P('null passed as parameter (not skipped)', r.params[1]===null);
console.log('   SQL:', r.sql);

// partial update must not touch other columns
r=build({priceUzs:99000});
P('partial update only sets given field', r.sql.includes('price_uzs')&&!r.sql.includes('max_debtors'));
console.log('   SQL:', r.sql);

// 0 is a legitimate value, must not be dropped
r=build({maxStaff:0});
P('zero value preserved', r.params[1]===0 && r.sql.includes('max_staff'));

// empty body -> no destructive update
r=build({});
P('empty body performs no UPDATE', r.sql===null);

// false preserved
r=build({advancedStats:false});
P('false value preserved', r.params[1]===false);
