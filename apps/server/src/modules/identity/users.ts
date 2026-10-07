import type { Locale } from '@nasiya/shared';
import type { Pool } from 'pg';

export type { Locale };

export interface User {
  readonly id: string;
  readonly telegramUserId: number;
  readonly username: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly locale: Locale;
  readonly activeBusinessId: string | null;
  readonly trialUsedAt: Date | null;
}

export interface TelegramProfile {
  readonly id: number;
  readonly username?: string | undefined;
  readonly first_name?: string | undefined;
  readonly last_name?: string | undefined;
}

interface UserRow {
  id: string;
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  locale: Locale;
  active_business_id: string | null;
  trial_used_at: Date | null;
}

const COLUMNS =
  'id, telegram_user_id, username, first_name, last_name, locale, active_business_id, trial_used_at';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    // Telegram ID lari 2^52 dan kichik, Number xavfsiz
    telegramUserId: Number(row.telegram_user_id),
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    locale: row.locale,
    activeBusinessId: row.active_business_id,
    trialUsedAt: row.trial_used_at,
  };
}

/**
 * Telegram profilidan foydalanuvchini yaratadi yoki yangilaydi. Profil o'zgarmagan bo'lsa
 * yozuv qilinmaydi (har xabarda UPDATE bo'lmasligi uchun).
 */
export async function upsertTelegramUser(pool: Pool, profile: TelegramProfile): Promise<User> {
  const username = profile.username ?? null;
  const firstName = profile.first_name ?? null;
  const lastName = profile.last_name ?? null;

  const existing = await pool.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE telegram_user_id = $1`,
    [profile.id],
  );
  const row = existing.rows[0];
  if (
    row &&
    row.username === username &&
    row.first_name === firstName &&
    row.last_name === lastName
  ) {
    return toUser(row);
  }

  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (telegram_user_id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_user_id) DO UPDATE
       SET username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name
     RETURNING ${COLUMNS}`,
    [profile.id, username, firstName, lastName],
  );
  return toUser(rows[0]!);
}

export async function findUserById(pool: Pool, id: string): Promise<User | undefined> {
  const { rows } = await pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : undefined;
}

export async function setLocale(pool: Pool, userId: string, locale: Locale): Promise<void> {
  await pool.query('UPDATE users SET locale = $2 WHERE id = $1', [userId, locale]);
}
