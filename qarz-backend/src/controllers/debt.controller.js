import { z } from 'zod';
import { asyncHandler, NotFound } from '../utils/errors.js';
import { query } from '../db/pool.js';
import {
  createDebt,
  recordPayment,
  listDebtsForDebtor,
} from '../services/debt.service.js';
import { createPaymentLink } from '../services/payment.service.js';

export const debtSchemas = {
  create: z.object({
    debtorId: z.string().uuid(),
    direction: z.enum(['given', 'taken']).optional(),
    amount: z.number().positive(),
    note: z.string().optional(),
    dueDate: z.string().optional(),   // YYYY-MM-DD
    issuedAt: z.string().optional(),
  }),
  pay: z.object({
    amount: z.number().positive(),
    method: z.enum(['cash', 'click', 'payme', 'manual']).optional(),
    transactionId: z.string().optional(),
  }),
};

/**
 * Verify the debtor belongs to this user's tenant.
 */
const assertDebtorAccess = async (user, debtorId) => {
  const field = user.role === 'personal' ? 'owner_id' : 'shop_id';
  const value = user.role === 'personal' ? user.id : user.shopId;
  const { rows } = await query(
    `SELECT * FROM debtors WHERE id = $1 AND ${field} = $2`,
    [debtorId, value]
  );
  if (!rows[0]) throw NotFound('Qarzdor topilmadi');
  return rows[0];
};

const assertDebtAccess = async (user, debtId) => {
  const field = user.role === 'personal' ? 'd.owner_id' : 'd.shop_id';
  const value = user.role === 'personal' ? user.id : user.shopId;
  const { rows } = await query(
    `SELECT dt.* FROM debts dt JOIN debtors d ON d.id = dt.debtor_id
     WHERE dt.id = $1 AND ${field} = $2`,
    [debtId, value]
  );
  if (!rows[0]) throw NotFound('Qarz topilmadi');
  return rows[0];
};

export const addDebt = asyncHandler(async (req, res) => {
  const { user } = req;
  const debtor = await assertDebtorAccess(user, req.body.debtorId);
  const debt = await createDebt({
    debtorId: debtor.id,
    shopId: user.role === 'personal' ? null : user.shopId,
    direction: req.body.direction || 'given',
    amount: req.body.amount,
    note: req.body.note,
    dueDate: req.body.dueDate,
    issuedAt: req.body.issuedAt,
  });
  res.status(201).json(debt);
});

export const debtorHistory = asyncHandler(async (req, res) => {
  const { user } = req;
  await assertDebtorAccess(user, req.params.debtorId);
  const debts = await listDebtsForDebtor(req.params.debtorId);
  res.json(debts);
});

export const payDebt = asyncHandler(async (req, res) => {
  const { user } = req;
  await assertDebtAccess(user, req.params.id);
  const debt = await recordPayment({
    debtId: req.params.id,
    amount: req.body.amount,
    method: req.body.method,
    transactionId: req.body.transactionId,
  });
  res.json(debt);
});

export const generateLink = asyncHandler(async (req, res) => {
  const { user } = req;
  await assertDebtAccess(user, req.params.id);
  const link = await createPaymentLink(req.params.id);
  res.status(201).json(link);
});
