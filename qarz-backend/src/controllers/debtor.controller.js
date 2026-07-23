import { z } from 'zod';
import { asyncHandler, NotFound, Forbidden } from '../utils/errors.js';
import { query } from '../db/pool.js';
import { normalizePhone } from '../utils/phone.js';
import { assertDebtorQuota } from '../services/plan.service.js';

export const debtorSchemas = {
  create: z
    .object({
      fullName: z.string().min(1),
      phone: z.string().optional(),
      telegramId: z.number().int().optional(),
    })
    .refine((d) => !!d.phone || d.telegramId != null, {
      message:
        'Telefon raqami yoki Telegram ID dan kamida bittasi kerak — aks holda mijozga eslatma yuborib bo\'lmaydi',
      path: ['phone'],
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
  const normPhone = phone ? normalizePhone(phone) : null;

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

  const clauses = [`d.${scope.field} = $1`];
  const params = [scope.value];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(d.full_name ILIKE $${params.length} OR d.phone ILIKE $${params.length})`);
  }

  let having = '';
  if (filter === 'with_debt') having = 'HAVING COALESCE(SUM(CASE WHEN dt.status <> \'paid\' THEN dt.amount - dt.paid_amount ELSE 0 END),0) > 0';
  if (filter === 'no_debt') having = 'HAVING COALESCE(SUM(CASE WHEN dt.status <> \'paid\' THEN dt.amount - dt.paid_amount ELSE 0 END),0) = 0';

  const sql = `
    SELECT d.*,
           COALESCE(SUM(CASE WHEN dt.status <> 'paid' THEN dt.amount - dt.paid_amount ELSE 0 END),0) AS outstanding,
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
