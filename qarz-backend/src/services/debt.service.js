import { query, withTransaction } from '../db/pool.js';
import { NotFound, AppError } from '../utils/errors.js';

/**
 * Recompute a debt's status from its amounts and due date.
 */
export const computeStatus = (amount, paid, dueDate) => {
  const a = Number(amount);
  const p = Number(paid);
  if (p >= a) return 'paid';
  const overdue = dueDate && new Date(dueDate) < new Date(new Date().toDateString());
  if (p > 0) return overdue ? 'overdue' : 'partial';
  return overdue ? 'overdue' : 'open';
};

/**
 * Add a debt for a debtor. Also bumps that day's DailySales.debt_given for shops.
 */
export const createDebt = async ({ debtorId, shopId, direction, amount, note, dueDate, issuedAt }) => {
  return withTransaction(async (client) => {
    const status = computeStatus(amount, 0, dueDate);
    const { rows } = await client.query(
      `INSERT INTO debts (debtor_id, shop_id, direction, amount, note, due_date, issued_at, status)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, CURRENT_DATE), $8)
       RETURNING *`,
      [debtorId, shopId, direction, amount, note || null, dueDate || null, issuedAt || null, status]
    );
    const debt = rows[0];

    // Auto-aggregate into daily sales for shops when a debt is "given" (qarzga berildi)
    if (shopId && direction === 'given') {
      await client.query(
        `INSERT INTO daily_sales (shop_id, sale_date, cash_card, debt_given, total)
         VALUES ($1, $2, 0, $3, $3)
         ON CONFLICT (shop_id, sale_date)
         DO UPDATE SET debt_given = daily_sales.debt_given + EXCLUDED.debt_given,
                       total      = daily_sales.cash_card + daily_sales.debt_given + EXCLUDED.debt_given,
                       updated_at = now()`,
        [shopId, debt.issued_at, amount]
      );
    }
    return debt;
  });
};

/**
 * Record a (partial) payment against a debt and recompute status.
 */
export const recordPayment = async ({ debtId, amount, method, transactionId }) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM debts WHERE id = $1 FOR UPDATE', [debtId]);
    const debt = rows[0];
    if (!debt) throw NotFound('Qarz topilmadi');
    if (debt.status === 'paid') throw new AppError('Qarz allaqachon yopilgan', 409, 'ALREADY_PAID');

    const newPaid = Number(debt.paid_amount) + Number(amount);
    if (newPaid > Number(debt.amount) + 0.001) {
      throw new AppError('To\'lov summasi qarzdan oshib ketdi', 422, 'OVERPAY');
    }

    await client.query(
      `INSERT INTO payments (debt_id, amount, method, transaction_id)
       VALUES ($1,$2,$3,$4)`,
      [debtId, amount, method || 'manual', transactionId || null]
    );

    const status = computeStatus(debt.amount, newPaid, debt.due_date);
    const upd = await client.query(
      `UPDATE debts SET paid_amount = $1, status = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [newPaid, status, debtId]
    );
    return upd.rows[0];
  });
};

export const listDebtsForDebtor = async (debtorId) => {
  const { rows } = await query(
    'SELECT * FROM debts WHERE debtor_id = $1 ORDER BY created_at DESC',
    [debtorId]
  );
  return rows;
};
