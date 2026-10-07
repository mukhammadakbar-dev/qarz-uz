import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  OverpaymentError,
  toPublicError,
  ValidationError,
} from '../errors/index.js';
import { getContext, runWithContext, setContext } from './context.js';
import { createLogger, describeText } from './logger.js';
import { scrubEvent } from './sentry.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      cb();
    },
  });
  const logger = createLogger({ logLevel: 'debug', isProduction: true, env: 'test' }, stream);
  return { logger, lines };
}

describe('logger', () => {
  it('xabar matni, token va telefon maydonlarini yashiradi', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        text: 'Murod 450 ming',
        telegram: { botToken: '123:SECRET', text: 'Ali 50k' },
        phone: '+998901234567',
        req: { headers: { authorization: 'Bearer abc', 'x-telegram-bot-api-secret-token': 'sss' } },
        apiKey: 'gemini',
      },
      'update',
    );
    const text = JSON.stringify(lines[0]);
    for (const leaked of [
      'Murod',
      '450',
      'SECRET',
      'Ali 50k',
      '998901234567',
      'Bearer',
      'sss',
      'gemini',
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(lines[0]?.['msg']).toBe('update');
  });

  it('kontekst maydonlarini (requestId, updateId, businessId, userId) qo‘shadi', () => {
    const { logger, lines } = capture();
    runWithContext({ requestId: 'req-1', updateId: 77 }, () => {
      setContext({ businessId: 'biz-1', userId: 'usr-1' });
      logger.info('ok');
    });
    expect(lines[0]).toMatchObject({
      requestId: 'req-1',
      updateId: 77,
      businessId: 'biz-1',
      userId: 'usr-1',
    });
  });

  it('kontekstdan tashqarida ham ishlaydi', () => {
    const { logger, lines } = capture();
    logger.info('boshlanish');
    expect(lines[0]?.['requestId']).toBeUndefined();
    expect(getContext()).toBeUndefined();
  });

  it('log darajasi va servis nomi mavjud', () => {
    const { logger, lines } = capture();
    logger.warn('x');
    expect(lines[0]).toMatchObject({ level: 'warn', service: 'nasiya-server' });
  });
});

describe('describeText', () => {
  it('mazmunni oshkor qilmaydi, bir xil matn uchun bir xil hash beradi', () => {
    const a = describeText('Murod 450 ming', 'k1');
    expect(a.len).toBe(14);
    expect(a.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(describeText('Murod 450 ming', 'k1')).toEqual(a);
    expect(describeText('Murod 450 ming', 'k2').hash).not.toBe(a.hash);
    expect(JSON.stringify(a)).not.toContain('Murod');
  });
});

describe('xatolar', () => {
  it('expose=true domen xatosini foydalanuvchiga ko‘rsatadi', () => {
    const { status, body } = toPublicError(new ForbiddenError());
    expect(status).toBe(403);
    expect(body.code).toBe('FORBIDDEN');
  });

  it('OverpaymentError maxPayable ni details da qaytaradi', () => {
    const { status, body } = toPublicError(new OverpaymentError(100000));
    expect(status).toBe(422);
    expect(body).toMatchObject({ code: 'OVERPAYMENT', details: { maxPayable: 100000 } });
  });

  it('kutilmagan xato tafsilotsiz INTERNAL qaytadi', () => {
    const { status, body } = toPublicError(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
    );
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('expose=false domen xatosi ham yashirinadi', () => {
    const err = new DomainError('CONFLICT', 409, 'ichki sabab', { expose: false });
    expect(toPublicError(err).status).toBe(500);
  });

  it('subclass nomi va cause saqlanadi', () => {
    const cause = new Error('asl');
    const err = new ConflictError('band', { cause });
    expect(err.name).toBe('ConflictError');
    expect(err.cause).toBe(cause);
    expect(new ValidationError('x')).toBeInstanceOf(DomainError);
  });
});

describe('sentry scrubEvent', () => {
  it('so‘rov tanasi, header va foydalanuvchini olib tashlaydi', () => {
    const event = scrubEvent({
      type: undefined,
      request: { data: 'Murod 50 ming', headers: { authorization: 'x' }, url: '/webhook' },
      user: { id: '1', username: 'ali' },
    });
    expect(event.request).toEqual({ url: '/webhook' });
    expect(event.user).toBeUndefined();
  });
});
