import type { Pool } from 'pg';
import { withTransaction } from '../../db/pool.js';
import { ValidationError } from '../../errors/index.js';
import type { Logger } from '../../observability/logger.js';
import { adminAudit, STATE_SQL, type SegmentState } from './service.js';

/**
 * Egalar (va ixtiyoriy xodimlar)ga xabar yuborish (ADR-0008).
 * Qabul qiluvchilar yaratilish paytida `broadcast_recipients` ga yoziladi: yuboruvchi faqat PENDING qatorlarni
 * oladi va natijani shu qatorda saqlaydi, shuning uchun jarayon qayta ishga tushsa ham hech kimga ikki marta
 * yuborilmaydi. Bitta odam bir nechta do'konda bo'lsa ham bitta xabar oladi.
 */

export const SEGMENTS: readonly SegmentState[] = ['TRIAL', 'ACTIVE', 'EXPIRED'];
export const MAX_BROADCAST_LENGTH = 4000;

export interface Audience {
  readonly segments: readonly SegmentState[];
  readonly includeStaff: boolean;
}

function validateAudience(a: Audience): void {
  if (a.segments.length === 0 || a.segments.some((s) => !SEGMENTS.includes(s)))
    throw new ValidationError('Kamida bitta segment tanlang', { details: { field: 'segments' } });
}

const RECIPIENTS_SQL = `
  SELECT DISTINCT u.id AS user_id, u.telegram_user_id
    FROM business_members m
    JOIN users u ON u.id = m.user_id
    JOIN businesses b ON b.id = m.business_id
    LEFT JOIN subscriptions s ON s.business_id = b.id
   WHERE m.status = 'ACTIVE'
     AND (m.role = 'OWNER' OR $2)
     AND (${STATE_SQL}) = ANY($1::text[])`;

/** Necha kishiga borishi (yuborishdan oldin ko'rsatish uchun). */
export async function countRecipients(sys: Pool, audience: Audience): Promise<number> {
  validateAudience(audience);
  const { rows } = await sys.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${RECIPIENTS_SQL}) r`,
    [audience.segments, audience.includeStaff],
  );
  return rows[0]?.n ?? 0;
}

export async function createBroadcast(
  sys: Pool,
  input: Audience & { text: string; actorUserId: string },
): Promise<{ id: string; total: number }> {
  validateAudience(input);
  const text = input.text.trim();
  if (!text || text.length > MAX_BROADCAST_LENGTH)
    throw new ValidationError('Xabar 1–4000 belgi bo‘lishi kerak', { details: { field: 'text' } });

  return withTransaction(sys, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO broadcasts (created_by, text, segments, include_staff, total)
       VALUES ($1, $2, $3, $4, 0) RETURNING id`,
      [input.actorUserId, text, input.segments, input.includeStaff],
    );
    const id = rows[0]!.id;
    const inserted = await c.query(
      `INSERT INTO broadcast_recipients (broadcast_id, user_id, telegram_user_id)
       SELECT $3, r.user_id, r.telegram_user_id FROM (${RECIPIENTS_SQL}) r`,
      [input.segments, input.includeStaff, id],
    );
    const total = inserted.rowCount ?? 0;
    await c.query(
      `UPDATE broadcasts SET total = $2, status = CASE WHEN $2 = 0 THEN 'DONE' ELSE status END,
              finished_at = CASE WHEN $2 = 0 THEN now() END
        WHERE id = $1`,
      [id, total],
    );
    await adminAudit(c, {
      actorUserId: input.actorUserId,
      businessId: null,
      action: 'broadcast.create',
      entity: 'broadcast',
      entityId: id,
      after: {
        segments: input.segments,
        includeStaff: input.includeStaff,
        total,
        length: text.length,
      },
    });
    return { id, total };
  });
}

export interface BroadcastSummary {
  readonly id: string;
  readonly text: string;
  readonly segments: SegmentState[];
  readonly includeStaff: boolean;
  readonly status: 'SENDING' | 'DONE';
  readonly total: number;
  readonly sent: number;
  readonly failed: number;
  readonly blocked: number;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly createdBy: string;
}

export async function listBroadcasts(sys: Pool, limit = 20): Promise<BroadcastSummary[]> {
  const { rows } = await sys.query<{
    id: string;
    text: string;
    segments: SegmentState[];
    include_staff: boolean;
    status: 'SENDING' | 'DONE';
    total: number;
    sent: number;
    failed: number;
    blocked: number;
    created_at: Date;
    finished_at: Date | null;
    created_by: string;
  }>(
    `SELECT b.id, b.text, b.segments, b.include_staff, b.status, b.total, b.created_at, b.finished_at,
            COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.username,
                     u.telegram_user_id::text) AS created_by,
            count(r.*) FILTER (WHERE r.status = 'SENT')::int AS sent,
            count(r.*) FILTER (WHERE r.status = 'FAILED')::int AS failed,
            count(r.*) FILTER (WHERE r.status = 'BLOCKED')::int AS blocked
       FROM broadcasts b
       JOIN users u ON u.id = b.created_by
       LEFT JOIN broadcast_recipients r ON r.broadcast_id = b.id
      GROUP BY b.id, u.id
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    segments: r.segments,
    includeStaff: r.include_staff,
    status: r.status,
    total: r.total,
    sent: r.sent,
    failed: r.failed,
    blocked: r.blocked,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    createdBy: r.created_by,
  }));
}

/** Telegram xatosi: bot bloklangan / chat yo'q (qayta urinish foydasiz) yoki 429 (kutish kerak). */
function classify(error: unknown): {
  kind: 'blocked' | 'retry' | 'failed';
  waitMs?: number;
  text: string;
} {
  const e = error as {
    error_code?: number;
    description?: string;
    parameters?: { retry_after?: number };
  };
  const text = (e.description ?? (error instanceof Error ? error.message : String(error))).slice(
    0,
    300,
  );
  if (e.error_code === 429)
    return { kind: 'retry', waitMs: (e.parameters?.retry_after ?? 1) * 1000, text };
  if (
    e.error_code === 403 ||
    (e.error_code === 400 && /chat not found|user is deactivated/i.test(text))
  )
    return { kind: 'blocked', text };
  return { kind: 'failed', text };
}

export interface SenderDeps {
  readonly sys: Pool;
  readonly logger: Logger;
  readonly send: (chatId: number, text: string) => Promise<unknown>;
  /** Xabarlar orasidagi pauza (Telegram: ~30 xabar/soniya; zaxira bilan ~20). */
  readonly intervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Xato bilan tugagan xabarlar bo'lsa operatorga (T6.3). */
  readonly alert?: (key: string, text: string) => void;
}

/**
 * Bitta jarayon ichida ketma-ket yuboruvchi (ADR-0001: bitta PM2 instance). `kick()` navbatdagi
 * tugallanmagan broadcast'larni ishlatadi; ishlayotgan bo'lsa qayta boshlamaydi.
 */
export class BroadcastSender {
  private running: Promise<void> | null = null;
  private stopped = false;
  constructor(private readonly deps: SenderDeps) {}

  /** Tugallanmagan broadcast'larni yuborishni boshlaydi (yoki davom ettiradi). */
  kick(): Promise<void> {
    this.running ??= this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    const { sys, logger } = this.deps;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const interval = this.deps.intervalMs ?? 50;
    let failed = 0;
    while (!this.stopped) {
      const next = await sys.query<{
        broadcast_id: string;
        user_id: string;
        telegram_user_id: string;
        text: string;
      }>(
        `SELECT r.broadcast_id, r.user_id, r.telegram_user_id::text, b.text
           FROM broadcast_recipients r JOIN broadcasts b ON b.id = r.broadcast_id
          WHERE r.status = 'PENDING' AND b.status = 'SENDING'
          ORDER BY b.created_at, r.user_id
          LIMIT 50`,
      );
      if (next.rows.length === 0) break;
      for (const r of next.rows) {
        if (this.stopped) return;
        let attempts = 0;
        for (;;) {
          try {
            await this.deps.send(Number(r.telegram_user_id), r.text);
            await this.mark(r.broadcast_id, r.user_id, 'SENT', null);
            break;
          } catch (error) {
            const c = classify(error);
            if (c.kind === 'retry' && attempts++ < 3) {
              await sleep(c.waitMs ?? 1000);
              continue;
            }
            await this.mark(
              r.broadcast_id,
              r.user_id,
              c.kind === 'blocked' ? 'BLOCKED' : 'FAILED',
              c.text,
            );
            if (c.kind !== 'blocked') {
              failed++;
              logger.warn({ broadcastId: r.broadcast_id }, 'broadcast xabari yuborilmadi');
            }
            break;
          }
        }
        await sleep(interval);
      }
    }
    if (failed > 0)
      this.deps.alert?.(
        'broadcast',
        `⚠️ Kissa: ommaviy xabarda ${failed} ta xabar xato bilan yuborilmadi (Admin → Ommaviy xabar).`,
      );
    // Hamma qabul qiluvchisi ishlangan broadcast'lar yakunlanadi
    await sys.query(
      `UPDATE broadcasts b SET status = 'DONE', finished_at = now()
        WHERE b.status = 'SENDING'
          AND NOT EXISTS (SELECT 1 FROM broadcast_recipients r
                           WHERE r.broadcast_id = b.id AND r.status = 'PENDING')`,
    );
  }

  private async mark(
    broadcastId: string,
    userId: string,
    status: 'SENT' | 'FAILED' | 'BLOCKED',
    error: string | null,
  ): Promise<void> {
    await this.deps.sys.query(
      `UPDATE broadcast_recipients SET status = $3, error = $4, sent_at = now()
        WHERE broadcast_id = $1 AND user_id = $2 AND status = 'PENDING'`,
      [broadcastId, userId, status, error],
    );
  }
}
