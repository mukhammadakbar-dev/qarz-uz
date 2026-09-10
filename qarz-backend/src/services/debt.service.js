import { query, withTransaction } from '../db/pool.js';
import { NotFound, AppError } from '../utils/errors.js';

/**
 * Recompute a debt's status from its amounts and due date.
 */
export const computeStatus = (amount, paid, dueDate) => {
  const a = Number(amount);
  const p = Number(paid);
  if (p >= a) return 'paid';
  // A debt is overdue once its due DATE is behind us — compare calendar days,
  // not instants, so a debt due today never flips to overdue mid-afternoon.
  // (The previous `new Date(new Date().toDateString())` round-trip relied on
  // parsing an implementation-defined date string.)
  const overdue = Boolean(dueDate) && startOfDay(dueDate) < startOfDay(new Date());
  if (p > 0) return overdue ? 'overdue' : 'partial';
  return overdue ? 'overdue' : 'open';
};

const startOfDay = (value) => {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
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
    // FOR UPDATE serialises concurrent payments against the same debt, so the
    // read-modify-write of paid_amount below can't lose an update.
    const { rows } = await client.query('SELECT * FROM debts WHERE id = $1 FOR UPDATE', [debtId]);
    const debt = rows[0];
    if (!debt) throw NotFound('Qarz topilmadi');
    if (debt.status === 'paid') throw new AppError('Qarz allaqachon yopilgan', 409, 'ALREADY_PAID');

    const newPaid = Number(debt.paid_amount) + Number(amount);
    if (newPaid > Number(debt.amount) + 0.001) {
      throw new AppError('To\'lov summasi qarzdan oshib ketdi', 422, 'OVERPAY');
    }

    // uq_payments_txn (migration 004) rejects a repeat of the same gateway
    // transaction; surface it as an explicit conflict rather than a 500.
    try {
      await client.query(
        `INSERT INTO payments (debt_id, amount, method, transaction_id)
         VALUES ($1,$2,$3,$4)`,
        [debtId, amount, method || 'manual', transactionId || null]
      );
    } catch (err) {
      if (err.code === '23505') {
        throw new AppError('Bu to\'lov allaqachon qayd etilgan', 409, 'DUPLICATE_PAYMENT');
      }
      throw err;
    }

    const status = computeStatus(debt.amount, newPaid, debt.due_date);
    const upd = await client.query(
      `UPDATE debts SET paid_amount = $1, status = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [newPaid, status, debtId]
    );
    return upd.rows[0];
  });
};

/**
 * Correct a debt that was entered wrongly.
 *
 * Until this existed a mistyped amount was permanent: there was no PATCH and no
 * DELETE, so the only way to "fix" a wrong entry was to record a payment that
 * never happened — which then corrupted the payment ledger as well.
 *
 * The daily_sales rollup has to move with the amount. createDebt adds the debt
 * to that day's `debt_given`, and nothing subtracted it again, so every
 * correction would have left the shop's turnover reporting permanently wrong.
 */
export const updateDebt = async ({ debtId, amount, dueDate, note }) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM debts WHERE id = $1 FOR UPDATE', [debtId]);
    const debt = rows[0];
    if (!debt) throw NotFound('Qarz topilmadi');

    const newAmount = amount === undefined ? Number(debt.amount) : Number(amount);
    const paid = Number(debt.paid_amount);

    // Lowering a debt below what has already been paid would mean the customer
    // overpaid a debt that never existed at that size; there is no sane way to
    // represent that, so refuse rather than silently clamp.
    if (newAmount < paid - 0.001) {
      throw new AppError(
        `Summani ${paid.toLocaleString('ru-RU')} so'mdan past qilib bo'lmaydi — shuncha to'lov qabul qilingan.`,
        422,
        'BELOW_PAID'
      );
    }

    const newDue = dueDate === undefined ? debt.due_date : (dueDate || null);
    const newNote = note === undefined ? debt.note : (note || null);
    const status = computeStatus(newAmount, paid, newDue);

    const upd = await client.query(
      `UPDATE debts SET amount = $1, due_date = $2, note = $3, status = $4, updated_at = now()
       WHERE id = $5 RETURNING *`,
      [newAmount, newDue, newNote, status, debtId]
    );

    await adjustDailySales(client, debt, newAmount - Number(debt.amount));
    return upd.rows[0];
  });
};

/**
 * Remove a debt entered by mistake.
 *
 * Refused once any payment has been recorded against it: those rows would be
 * cascade-deleted with the debt, erasing money that really did change hands.
 * Correcting the amount is the right move there, not deletion.
 */
export const deleteDebt = async (debtId) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM debts WHERE id = $1 FOR UPDATE', [debtId]);
    const debt = rows[0];
    if (!debt) throw NotFound('Qarz topilmadi');

    const paid = await client.query(
      'SELECT COUNT(*)::int AS c FROM payments WHERE debt_id = $1',
      [debtId]
    );
    if (paid.rows[0].c > 0) {
      throw new AppError(
        'Bu qarzga to\'lov qayd etilgan — o\'chirib bo\'lmaydi. Summani to\'g\'rilang.',
        409,
        'HAS_PAYMENTS'
      );
    }

    await adjustDailySales(client, debt, -Number(debt.amount));
    await client.query('DELETE FROM debts WHERE id = $1', [debtId]);
    return { ok: true };
  });
};

/**
 * Move a shop's daily_sales rollup by `delta` for the day the debt was issued.
 *
 * Only 'given' debts for a shop ever entered that rollup (see createDebt), so
 * only those may leave it. GREATEST(...,0) keeps the row from going negative if
 * the underlying rows were ever edited out from under us.
 */
const adjustDailySales = async (client, debt, delta) => {
  if (!delta || !debt.shop_id || debt.direction !== 'given') return;
  await client.query(
    `UPDATE daily_sales
     SET debt_given = GREATEST(debt_given + $3, 0),
         total      = cash_card + GREATEST(debt_given + $3, 0),
         updated_at = now()
     WHERE shop_id = $1 AND sale_date = $2`,
    [debt.shop_id, debt.issued_at, delta]
  );
};

export const listDebtsForDebtor = async (debtorId) => {
  const { rows } = await query(
    'SELECT * FROM debts WHERE debtor_id = $1 ORDER BY created_at DESC',
    [debtorId]
  );
  return rows;
};
