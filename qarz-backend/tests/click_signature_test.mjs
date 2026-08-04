// Tests the REAL verifyClickSignature (click_test.mjs reimplements its own
// copy of the signing logic, so it never exercised this function).
//
// The critical case: with no CLICK_SECRET_KEY configured, the md5 is computed
// entirely from values the caller controls, so anyone could forge a valid
// sign_string and have arbitrary debts marked as paid. It must fail closed.
//
// config/index.js reads the environment once at import time and module state is
// cached per process, so each configuration is exercised in its own child.
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const SECRET = 'click-secret-key';
const SERVICE = '12345';

const sign = (p, secret) =>
  crypto
    .createHash('md5')
    .update(
      `${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}` +
        `${p.merchant_prepare_id ?? ''}${p.amount}${p.action}${p.sign_time}`
    )
    .digest('hex');

const params = (o = {}) => ({
  click_trans_id: '999',
  service_id: SERVICE,
  merchant_trans_id: 'tok1',
  amount: 50000,
  action: '1',
  sign_time: '2026-07-22 10:00:00',
  ...o,
});

// ---- child mode: verify one payload under the inherited env, print true/false
if (process.argv[2] === '--child') {
  const { verifyClickSignature } = await import('../src/services/payment.service.js');
  process.stdout.write(String(verifyClickSignature(JSON.parse(process.argv[3]))));
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
const verifyIn = (env, payload) => {
  const res = spawnSync(process.execPath, [self, '--child', JSON.stringify(payload)], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`child failed: ${res.stderr}`);
  return res.stdout.trim() === 'true';
};

let failures = 0;
const P = (n, c, extra = '') => {
  if (!c) failures++;
  console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
};

// ---------------------------------------------- unconfigured -> fail closed
console.log('--- CLICK_SECRET_KEY not configured ---');
const OFF = { CLICK_SECRET_KEY: '', CLICK_SERVICE_ID: '' };
{
  // An attacker knows every input except the secret; with no secret they can
  // compute the digest themselves.
  const p = params();
  p.sign_string = sign(p, '');
  P('forged signature with empty secret is REJECTED', verifyIn(OFF, p) === false);
  P('missing sign_string rejected', verifyIn(OFF, params()) === false);
}

// ------------------------------------------------------------- configured
console.log('\n--- CLICK_SECRET_KEY configured ---');
const ON = { CLICK_SECRET_KEY: SECRET, CLICK_SERVICE_ID: SERVICE };
{
  const good = params();
  good.sign_string = sign(good, SECRET);
  P('correctly signed callback accepted', verifyIn(ON, good) === true);

  const upper = params();
  upper.sign_string = sign(upper, SECRET).toUpperCase();
  P('uppercase hex signature accepted', verifyIn(ON, upper) === true);

  const tampered = params();
  tampered.sign_string = sign(tampered, SECRET);
  tampered.amount = 1;
  P('tampered amount rejected', verifyIn(ON, tampered) === false);

  const wrongSecret = params();
  wrongSecret.sign_string = sign(wrongSecret, 'not-the-secret');
  P('wrong secret rejected', verifyIn(ON, wrongSecret) === false);

  const otherService = params({ service_id: '99999' });
  otherService.sign_string = sign(otherService, SECRET);
  P('callback for a different service_id rejected', verifyIn(ON, otherService) === false);

  const complete = params({ merchant_prepare_id: 'prep-1' });
  complete.sign_string = sign(complete, SECRET);
  P('Complete step (with merchant_prepare_id) accepted', verifyIn(ON, complete) === true);

  P('non-string sign_string rejected', verifyIn(ON, params({ sign_string: 12345 })) === false);
  P('empty sign_string rejected', verifyIn(ON, params({ sign_string: '' })) === false);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
