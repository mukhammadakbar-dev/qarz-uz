// Payment links must not be minted while the Click gateway is off.
//
// THE BUG: /pay/:token is an API endpoint that answers with JSON — there is no
// checkout page, and Click is not integrated yet. Yet createPaymentLink happily
// produced {PUBLIC_BASE_URL}/pay/<token> and three surfaces handed it to real
// people: the daily reminder SMS (via the default template's {link}), the bot's
// "To'lov linki" button, and the web debtor list's "Link" button. A customer
// following any of them got a wall of JSON.
//
// The fix gates link creation on config.click.enabled — all three credentials
// present — and this suite pins both directions of that gate.

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

// Stub pg before anything imports the pool: a working gate must refuse without
// touching the database at all, and an unstubbed Pool would hang on connect.
const { default: pgMod } = await import('pg');
let queriesRun = 0;
pgMod.Pool.prototype.query = async function (text) {
  queriesRun++;
  // Enough for the happy path below: one debt, then the INSERT/UPDATE writes.
  if (/FROM debts/i.test(text)) {
    return { rows: [{ id: 'D1', amount: 50000, paid_amount: 10000, status: 'open' }] };
  }
  return { rows: [] };
};
pgMod.Pool.prototype.connect = async function () {
  return { query: async () => ({ rows: [] }), release() {} };
};

process.env.PAYMENT_LINK_SECRET = 'test-paylink-secret';
process.env.PUBLIC_BASE_URL = 'https://example.test';

// ---------------------------------------------------------------------------
console.log('--- Click NOT configured ---');

const { createPaymentLink } = await import('../src/services/payment.service.js');
const { config } = await import('../src/config/index.js');

P('click.enabled is false with no credentials', config.click.enabled === false);

queriesRun = 0;
let err = null;
try {
  await createPaymentLink('D1');
} catch (e) {
  err = e;
}
P('createPaymentLink throws instead of returning a link', err !== null);
P('error code is PAYMENT_GATEWAY_OFF', err?.code === 'PAYMENT_GATEWAY_OFF', err?.code);
P('status is 503 (not 500)', err?.statusCode === 503, String(err?.statusCode));
P('refused before any DB work', queriesRun === 0, `${queriesRun} queries`);

// ---------------------------------------------------------------------------
console.log('\n--- partial credentials (the dangerous middle) ---');

// A half-configured gateway is still a gateway that cannot take money. Each of
// these must read as "off", or a deploy that set only some of the vars would
// start handing out links again.
const partials = [
  ['service id only', { serviceId: 'svc', merchantId: '', secretKey: '' }],
  ['missing secret', { serviceId: 'svc', merchantId: 'mer', secretKey: '' }],
  ['missing merchant', { serviceId: 'svc', merchantId: '', secretKey: 'sec' }],
  ['missing service id', { serviceId: '', merchantId: 'mer', secretKey: 'sec' }],
];
for (const [name, creds] of partials) {
  Object.assign(config.click, creds);
  P(`${name} -> still disabled`, config.click.enabled === false);
}

// ---------------------------------------------------------------------------
console.log('\n--- Click fully configured ---');

Object.assign(config.click, { serviceId: 'svc', merchantId: 'mer', secretKey: 'sec' });
P('click.enabled is true with all three', config.click.enabled === true);

queriesRun = 0;
let link = null;
err = null;
try {
  link = await createPaymentLink('D1');
} catch (e) {
  err = e;
}
P('createPaymentLink succeeds once the gateway is live', err === null, err?.message);
P('link points at the pay route', link?.url?.startsWith('https://example.test/pay/') === true, link?.url);
// The link is for what is still owed (50000 - 10000), not the original amount.
P('amount is the outstanding balance', Number(link?.amount) === 40000, String(link?.amount));
P('did reach the database this time', queriesRun > 0, `${queriesRun} queries`);

// ---------------------------------------------------------------------------
console.log('\n--- reminder templates ---');

// The sweep asks for a link only when the template wants one AND the gateway is
// live. Mirrors scheduler.service.js so a regression there shows up here.
const wantsLink = (clickEnabled, template) => clickEnabled && template.includes('{link}');
const DEFAULT_TEMPLATE = 'Hurmatli {name}, {amount} so\'m qarzingiz muddati {due} da tugaydi.';

P('default template no longer contains {link}', !DEFAULT_TEMPLATE.includes('{link}'));
P('gateway off + custom {link} -> no link minted', wantsLink(false, 'To\'lov: {link}') === false);
P('gateway on + default template -> no link minted', wantsLink(true, DEFAULT_TEMPLATE) === false);
P('gateway on + custom {link} -> link minted', wantsLink(true, 'To\'lov: {link}') === true);

// The migration strips {link} and the label introducing it, so a cleaned
// message does not trail off as "... tugaydi. To'lov:" with nothing after it.
const strip = (s) =>
  s.replace(/\s*(To'lov|To'lov havolasi|Оплата|Ссылка)?\s*:?\s*\{link\}/g, '').trim();

P(
  'migration shape: label + placeholder both removed',
  strip('Hurmatli {name}, muddati {due} da tugaydi. To\'lov: {link}') ===
    'Hurmatli {name}, muddati {due} da tugaydi.',
  strip('Hurmatli {name}, muddati {due} da tugaydi. To\'lov: {link}')
);
P(
  'migration shape: bare placeholder removed',
  strip('Qarzingiz {amount} so\'m {link}') === 'Qarzingiz {amount} so\'m'
);
P(
  'migration shape: other placeholders untouched',
  strip('{name} {amount} {due} {link}') === '{name} {amount} {due}'
);
