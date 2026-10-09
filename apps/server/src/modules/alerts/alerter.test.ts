import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/index.js';
import { createLogger } from '../../observability/logger.js';
import { onUnexpectedError, reportError } from '../../observability/sentry.js';
import { ValidationError } from '../../errors/index.js';
import { Alerter, describeError } from './alerter.js';

const logger = createLogger(
  loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: 'postgres://x@localhost/x',
    TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    TELEGRAM_WEBHOOK_SECRET: 'test_webhook_secret_1234567890',
    SESSION_SECRET: 'x'.repeat(32),
  }),
  new Writable({ write: (_c, _e, cb) => cb() }),
);

function setup(opts: { chatIds?: number[]; fail?: boolean } = {}) {
  let now = 1_000_000;
  const sent: { chatId: number; text: string }[] = [];
  const alerter = new Alerter({
    chatIds: opts.chatIds ?? [111, 222],
    logger,
    now: () => now,
    async send(chatId, text) {
      if (opts.fail) throw new Error('telegram yiqildi');
      sent.push({ chatId, text });
    },
  });
  return { alerter, sent, advance: (ms: number) => (now += ms) };
}

describe('Alerter', () => {
  it('har superadmin‘ga yuboradi; bir xil kalit 30 daqiqada bir marta', async () => {
    const { alerter, sent, advance } = setup();
    expect(await alerter.notify('reconcile', 'A')).toBe(true);
    expect(await alerter.notify('reconcile', 'A')).toBe(false);
    expect(await alerter.notify('boshqa', 'B')).toBe(true);
    advance(31 * 60_000);
    expect(await alerter.notify('reconcile', 'A')).toBe(true);
    expect(sent.map((m) => m.chatId)).toEqual([111, 222, 111, 222, 111, 222]);
  });

  it('5 daqiqada 5 ta xato — bitta ogohlantirish; oyna siljiydi', async () => {
    const { alerter, sent, advance } = setup({ chatIds: [111] });
    for (let i = 0; i < 4; i++) alerter.recordError(new TypeError('x'));
    await Promise.resolve();
    expect(sent).toEqual([]);
    advance(6 * 60_000); // eskilari oynadan chiqdi
    for (let i = 0; i < 4; i++) alerter.recordError(new TypeError('x'));
    expect(sent).toEqual([]);
    alerter.recordError(Object.assign(new Error('maxfiy: Murod 50 ming'), { code: '23505' }));
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('5 ta kutilmagan xato');
    expect(sent[0]!.text).toContain('Error (23505)');
    expect(sent[0]!.text).not.toContain('Murod');
  });

  it('yuborish xatosi otilmaydi; chat bo‘lmasa yuborilmaydi', async () => {
    await expect(setup({ fail: true }).alerter.notify('k', 't')).resolves.toBe(true);
    expect(await setup({ chatIds: [] }).alerter.notify('k', 't')).toBe(false);
  });

  it('describeError faqat tur va kod', () => {
    expect(describeError(new RangeError('summa 5000'))).toBe('RangeError');
    expect(describeError('matn')).toBe('string');
  });

  it('reportError kutilmagan xatoni kuzatuvchiga beradi, kutilgan domen xatosini emas', () => {
    const seen: unknown[] = [];
    const off = onUnexpectedError((e) => seen.push(e));
    reportError(new ValidationError('noto‘g‘ri'));
    const boom = new Error('boom');
    reportError(boom);
    off();
    reportError(new Error('obunadan keyin'));
    expect(seen).toEqual([boom]);
  });
});
