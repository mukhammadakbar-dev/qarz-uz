import { z } from 'zod';
import { asyncHandler, NotFound, AppError } from '../utils/errors.js';
import { query } from '../db/pool.js';
import { normalizePhone } from '../utils/phone.js';
import { assertDebtorQuota } from '../services/plan.service.js';

// Letters (Latin + Cyrillic incl. Uzbek), spaces, hyphen, apostrophes only.
const NAME_RE = /^[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳÀ-ÿʻʼ'’\-\s.]+$/u;

const nameField = z
  .string()
  .trim()
  .min(2, 'Ism kamida 2 belgidan iborat bo\'lishi kerak')
  .max(120, 'Ism juda uzun')
  .regex(NAME_RE, 'Ism faqat harflardan iborat bo\'lishi kerak');

// Accept how people actually type numbers; normalizePhone does the real check.
const phoneField = z
  .string()
  .trim()
  .min(7, 'Telefon raqami juda qisqa')
  .max(20, 'Telefon raqami juda uzun')
  .regex(/^[\d\s()+-]+$/, 'Telefon raqami faqat raqamlardan iborat bo\'lishi kerak');

export const debtorSchemas = {
  create: z
    .object({
      fullName: nameField,
      phone: phoneField.optional(),
      telegramId: z.number().int().optional(),
    })
    .refine((d) => !!d.phone || d.telegramId != null, {
      message:
        'Telefon raqami yoki Telegram ID dan kamida bittasi kerak — aks holda mijozga eslatma yuborib bo\'lmaydi',
      path: ['phone'],
    }),
  update: z
    .object({
      fullName: nameField.optional(),
      // null explicitly clears the value; undefined leaves it untouched
      phone: phoneField.nullable().optional(),
      telegramId: z.number().int().nullable().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, {
      message: 'Hech qanday o\'zgarish yuborilmadi',
    }),
  list: z.object({
    search: z.string().optional(),
    filter: z.enum(['all', 'with_debt', 'no_debt']).optional(),
  }),
};

/**
 * Scope: shop owners/staff see debtors in their shop; personal users see their own.
 */
const scopeParams = (user) => {
  if (user.role === 'personal') return { field: 'owner_id', value: user.id };
  return { field: 'shop_id', value: user.shopId };
};

export const createDebtor = asyncHandler(async (req, res) => {
  const { fullName, phone, telegramId } = req.body;
  const { user } = req;

  // Previously an unparseable phone was silently stored as NULL, leaving a
  // debtor who can never be contacted. Reject it instead.
  let normPhone = null;
  if (phone) {
    normPhone = normalizePhone(phone);
    if (!normPhone) {
      throw new AppError(
        'Telefon raqami noto\'g\'ri. Masalan: 90 123 45 67',
        422,
        'BAD_PHONE'
      );
    }
  }

  // plan limit applies to shops only (personal users are free/unlimited)
  if (user.role !== 'personal') {
    await assertDebtorQuota(user.shopId);
  }

  const { rows } = await query(
    `INSERT INTO debtors (owner_id, shop_id, full_name, phone, telegram_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [user.id, user.role === 'personal' ? null : user.shopId, fullName, normPhone, telegramId || null]
  );
  res.status(201).json(rows[0]);
});

export const listDebtors = asyncHandler(async (req, res) => {
  const { user } = req;
  const { search, filter } = req.query;
  const scope = scopeParams(user);

  const clauses = [`d.${scope.field} = $1`, 'd.is_archived = FALSE'];
  const params = [scope.value];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(d.full_name ILIKE $${params.length} OR d.phone ILIKE $${params.length})`);
  }

  let having = '';
  if (filter === 'with_debt') having = 'HAVING COALESCE(SUM(CASE WHEN dt.status <> \'paid\' THEN dt.amount - dt.paid_amount ELSE 0 END),0) > 0';
  if (filter === 'no_debt') having = 'HAVING COALESCE(SUM(CASE WHEN dt.status <> \'paid\' THEN dt.amount - dt.paid_amount ELSE 0 END),0) = 0';

  // Shop owners only ever record 'given' debts (money owed TO the shop), so a
  // single `outstanding` figure is unambiguous for them. Personal users can
  // record BOTH directions ('given' = owed to them, 'taken' = they owe), so
  // summing across both blindly would net two opposite meanings into one
  // number. We expose both breakdowns; `outstanding` stays as the net total
  // for backward compatibility with existing shop-owner UI and the with/no
  // debt filter above.
  const sql = `
    SELECT d.*,
           COALESCE(SUM(CASE WHEN dt.status <> 'paid' THEN dt.amount - dt.paid_amount ELSE 0 END),0) AS outstanding,
           COALESCE(SUM(CASE WHEN dt.status <> 'paid' AND dt.direction = 'given' THEN dt.amount - dt.paid_amount ELSE 0 END),0) AS outstanding_given,
           COALESCE(SUM(CASE WHEN dt.status <> 'paid' AND dt.direction = 'taken' THEN dt.amount - dt.paid_amount ELSE 0 END),0) AS outstanding_taken,
           COUNT(dt.id) AS debt_count
    FROM debtors d
    LEFT JOIN debts dt ON dt.debtor_id = d.id
    WHERE ${clauses.join(' AND ')}
    GROUP BY d.id
    ${having}
    ORDER BY d.created_at DESC
  `;
  const { rows } = await query(sql, params);
  res.json(rows);
});

export const getDebtor = asyncHandler(async (req, res) => {
  const { user } = req;
  const scope = scopeParams(user);
  const { rows } = await query(
    `SELECT * FROM debtors WHERE id = $1 AND ${scope.field} = $2`,
    [req.params.id, scope.value]
  );
  if (!rows[0]) throw NotFound('Qarzdor topilmadi');
  res.json(rows[0]);
});

/**
 * PATCH /api/debtors/:id — update name / phone / telegram id.
 * Tenant-scoped: you can only touch debtors belonging to your shop (or, for
 * personal users, to you).
 */
export const updateDebtor = asyncHandler(async (req, res) => {
  const { user } = req;
  const scope = scopeParams(user);
  const b = req.body;

  const existing = await query(
    `SELECT * FROM debtors WHERE id = $1 AND ${scope.field} = $2`,
    [req.params.id, scope.value]
  );
  const current = existing.rows[0];
  if (!current) throw NotFound('Qarzdor topilmadi');

  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

  // Validate/normalize the phone if one was supplied
  let normPhone;
  if (has('phone')) {
    if (b.phone === null || b.phone === '') {
      normPhone = null;
    } else {
      normPhone = normalizePhone(b.phone);
      if (!normPhone) {
        throw new AppError('Telefon raqami noto\'g\'ri. Masalan: 90 123 45 67', 422, 'BAD_PHONE');
      }
    }
  }

  // Keep the "reachable by at least one channel" guarantee after the update
  const nextPhone = has('phone') ? normPhone : current.phone;
  const nextTelegram = has('telegramId') ? b.telegramId : current.telegram_id;
  if (!nextPhone && nextTelegram == null) {
    throw new AppError(
      'Telefon raqami yoki Telegram ID dan kamida bittasi qolishi kerak',
      422,
      'CONTACT_REQUIRED'
    );
  }

  const sets = [];
  const params = [req.params.id, scope.value];
  const push = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (has('fullName')) push('full_name', b.fullName);
  if (has('phone')) push('phone', normPhone);
  if (has('telegramId')) push('telegram_id', b.telegramId);

  if (!sets.length) return res.json(current);

  sets.push('updated_at = now()');
  const { rows } = await query(
    `UPDATE debtors SET ${sets.join(', ')}
     WHERE id = $1 AND ${scope.field} = $2 RETURNING *`,
    params
  );
  res.json(rows[0]);
});

/**
 * DELETE /api/debtors/:id — archive (soft delete) by default.
 *
 * Hard deletion would cascade and destroy the debt history, so a debtor with
 * unpaid debts is refused outright (409 HAS_OPEN_DEBTS). Fully settled debtors
 * are archived rather than removed, preserving the ledger for later reference.
 */
export const deleteDebtor = asyncHandler(async (req, res) => {
  const { user } = req;
  const scope = scopeParams(user);

  const existing = await query(
    `SELECT * FROM debtors WHERE id = $1 AND ${scope.field} = $2`,
    [req.params.id, scope.value]
  );
  if (!existing.rows[0]) throw NotFound('Qarzdor topilmadi');

  const open = await query(
    `SELECT COALESCE(SUM(amount - paid_amount), 0) AS outstanding, COUNT(*) AS cnt
     FROM debts WHERE debtor_id = $1 AND status <> 'paid'`,
    [req.params.id]
  );
  const { outstanding, cnt } = open.rows[0];
  if (Number(cnt) > 0) {
    throw new AppError(
      `Bu mijozda ${cnt} ta to'lanmagan qarz bor (${Number(outstanding).toLocaleString('ru-RU')} so'm). Avval qarzlarni yoping.`,
      409,
      'HAS_OPEN_DEBTS'
    );
  }

  const { rows } = await query(
    `UPDATE debtors SET is_archived = TRUE, updated_at = now()
     WHERE id = $1 AND ${scope.field} = $2 RETURNING id, full_name, is_archived`,
    [req.params.id, scope.value]
  );
  res.json({ archived: true, debtor: rows[0] });
});
