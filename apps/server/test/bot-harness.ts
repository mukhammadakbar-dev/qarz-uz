import { Writable } from 'node:stream';
import type { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import { expect } from 'vitest';
import { createBot, type BotContext } from '../src/bot/bot.js';
import { loadConfig } from '../src/config/index.js';
import { createPool } from '../src/db/pool.js';
import { buildServer, WEBHOOK_PATH } from '../src/http/server.js';
import { createLogger } from '../src/observability/logger.js';
import type { AiDeps } from '../src/modules/interpretation/service.js';
import { resolveBusinessAccess, type BusinessAccess } from '../src/modules/tenancy/index.js';
import { TEST_APP_URL, TEST_SYSTEM_URL } from './env.js';

/** Haqiqiy Postgres + soxta Telegram API: butun bot oqimini boshidan oxirigacha sinash uchun. */

export const SECRET = 'test_webhook_secret_1234567890';

export interface Sent {
  readonly method: string;
  readonly payload: Record<string, unknown>;
}
export interface Btn {
  readonly text: string;
  readonly data: string | undefined;
}
type Markup = {
  inline_keyboard?: { text: string; callback_data?: string; web_app?: { url: string } }[][];
};

export interface Harness {
  readonly pool: Pool;
  /** RLS ni chetlab o'tuvchi rol: faqat tekshiruvlar uchun. */
  readonly sys: Pool;
  readonly sent: Sent[];
  person(name: string): Person;
  /** Odamni haqiqiy foydalanuvchi sifatida: onboarding orqali biznes ochadi. */
  owner(name: string, business?: string, lang?: 'uz-Latn' | 'uz-Cyrl'): Promise<Person>;
  /** Egasining havolasi orqali xodim sifatida ulanadi. */
  staff(owner: Person, name: string): Promise<Person>;
  access(p: Person): Promise<BusinessAccess>;
  userId(p: Person): Promise<string>;
  businessId(p: Person): Promise<string>;
  close(): Promise<void>;
}

let updateSeq = 40_000_000 + Math.floor(Math.random() * 1_000_000);
let telegramSeq = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);

export async function createHarness(
  options: { miniAppUrl?: string; ai?: AiDeps } = {},
): Promise<Harness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: TEST_APP_URL,
    TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    SESSION_SECRET: 'x'.repeat(32),
    SUPPORT_PHONE: '+998907900110',
    ...(options.miniAppUrl ? { MINIAPP_URL: options.miniAppUrl } : {}),
  });
  const pool = createPool(TEST_APP_URL, { max: 8 });
  const sys = createPool(TEST_SYSTEM_URL, { max: 2 });
  const logger = createLogger(config, new Writable({ write: (_c, _e, cb) => cb() }));
  const bot: Bot<BotContext> = createBot({
    config,
    logger,
    pool,
    ai: options.ai,
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'Kissa',
      username: 'kissauzbot',
    } as UserFromGetMe,
  });
  const sent: Sent[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return {
      ok: true,
      result:
        method === 'sendMessage'
          ? { message_id: 1, date: 1, chat: { id: 1, type: 'private' } }
          : true,
    } as never;
  });
  const app = buildServer({ config, logger, pool, bot });
  await app.ready();

  const deliver = async (update: object, repeat = 1) => {
    const results = await Promise.all(
      Array.from({ length: repeat }, () =>
        app.inject({
          method: 'POST',
          url: WEBHOOK_PATH,
          headers: { 'x-telegram-bot-api-secret-token': SECRET },
          payload: update as object,
        }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(200);
  };

  class PersonImpl implements Person {
    readonly id = telegramSeq++;
    constructor(readonly name: string) {}
    private from() {
      return { id: this.id, is_bot: false, first_name: this.name };
    }
    textUpdate(text: string, extra: object = {}) {
      const entities = text.startsWith('/')
        ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }]
        : undefined;
      return {
        update_id: updateSeq++,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: this.id, type: 'private' },
          from: this.from(),
          text,
          ...(entities ? { entities } : {}),
          ...extra,
        },
      };
    }
    text(text: string) {
      return deliver(this.textUpdate(text));
    }
    sendUpdate(update: object, repeat = 1) {
      return deliver(update, repeat);
    }
    /** `repeat` ta ALOHIDA bosish (har biri yangi update_id bilan, parallel). Bir xil update'ni takrorlash uchun sendUpdate. */
    async press(data: string, repeat = 1) {
      await Promise.all(
        Array.from({ length: repeat }, () =>
          deliver({
            update_id: updateSeq++,
            callback_query: {
              id: String(updateSeq),
              from: this.from(),
              chat_instance: 'ci',
              data,
              message: { message_id: 1, date: 1, chat: { id: this.id, type: 'private' } },
            },
          }),
        ),
      );
    }
    pressLabel(label: string, repeat = 1) {
      const b = this.buttons().find((x) => x.text.includes(label));
      if (!b?.data)
        throw new Error(
          `Tugma topilmadi: "${label}". Bor tugmalar: ${this.buttons()
            .map((x) => x.text)
            .join(' | ')}`,
        );
      return this.press(b.data, repeat);
    }
    messages(): { text: string; markup: Markup | undefined }[] {
      return sent
        .filter((s) => s.method === 'sendMessage' && s.payload['chat_id'] === this.id)
        .map((s) => ({
          text: String(s.payload['text']),
          markup: s.payload['reply_markup'] as Markup | undefined,
        }));
    }
    inbox() {
      return this.messages().map((m) => m.text);
    }
    last() {
      return this.messages().at(-1)?.text ?? '';
    }
    buttons(): Btn[] {
      const m = this.messages().at(-1);
      return (m?.markup?.inline_keyboard ?? [])
        .flat()
        .map((b) => ({ text: b.text, data: b.callback_data }));
    }
    since(mark: number) {
      return this.inbox().slice(mark);
    }
    mark() {
      return this.inbox().length;
    }
  }

  const harness: Harness = {
    pool,
    sys,
    sent,
    person: (name) => new PersonImpl(name),
    async owner(name, business = `${name} do‘koni`, lang = 'uz-Latn') {
      const p = new PersonImpl(name);
      await p.text('/start');
      await p.press(`lang:${lang}`);
      await p.text(business);
      return p;
    },
    async staff(owner, name) {
      const p = new PersonImpl(name);
      await owner.text('/invite');
      const payload = owner.last().match(/start=(inv_[A-Za-z0-9_-]+)/)![1]!;
      await p.text(`/start ${payload}`);
      return p;
    },
    async userId(p) {
      return (await sys.query('SELECT id FROM users WHERE telegram_user_id = $1', [p.id])).rows[0]
        .id as string;
    },
    async businessId(p) {
      const userId = await harness.userId(p);
      return (
        await sys.query(
          "SELECT business_id FROM business_members WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY created_at LIMIT 1",
          [userId],
        )
      ).rows[0].business_id as string;
    },
    async access(p) {
      const userId = await harness.userId(p);
      const businessId = await harness.businessId(p);
      return resolveBusinessAccess(pool, { id: userId, activeBusinessId: businessId });
    },
    async close() {
      await app.close();
      await Promise.all([pool.end(), sys.end()]);
    },
  };
  return harness;
}

export interface Person {
  readonly id: number;
  readonly name: string;
  text(text: string): Promise<void>;
  textUpdate(text: string, extra?: object): object;
  sendUpdate(update: object, repeat?: number): Promise<void>;
  press(data: string, repeat?: number): Promise<void>;
  pressLabel(label: string, repeat?: number): Promise<void>;
  messages(): { text: string; markup: Markup | undefined }[];
  inbox(): string[];
  last(): string;
  buttons(): Btn[];
  since(mark: number): string[];
  mark(): number;
}
