import { z } from 'zod';
import { asyncHandler, NotFound } from '../utils/errors.js';
import { query } from '../db/pool.js';
import {
  createDebt,
  recordPayment,
  listDebtsForDebtor,
} from '../services/debt.service.js';
import { createPaymentLink } from '../services/payment.service.js';
import { generateReceiptPng } from '../services/receiptService.js';
import { isoDate, uuid, money } from '../utils/validators.js';

export const debtSchemas = {
  create: z.object({
    debtorId: uuid,
    direction: z.enum(['given', 'taken']).optional(),
    amount: money,
    note: z.string().max(2000).optional(),
    dueDate: isoDate.optional(),
    issuedAt: isoDate.optional(),
  }),
  pay: z.object({
    amount: money,
    method: z.enum(['cash', 'click', 'payme', 'manual']).optional(),
    transactionId: z.string().max(120).optional(),
  }),
  idParam: z.object({ id: uuid }),
  debtorIdParam: z.object({ debtorId: uuid }),
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

export const getDebtReceipt = asyncHandler(async (req, res) => {
  const { user } = req;
  const debt = await assertDebtAccess(user, req.params.id);

  // Fetch shop and debtor details for receipt
  const { rows: debtorRows } = await query('SELECT * FROM debtors WHERE id = $1', [debt.debtor_id]);
  const debtor = debtorRows[0];

  // `req.user` is built by the authenticate middleware and exposes camelCase
  // `fullName`; reading `full_name` here was always undefined, so a personal
  // user's receipt fell back to the product name instead of showing their own.
  let shopName = 'TemirDaftar.uz';
  if (debt.shop_id) {
    const { rows: shopRows } = await query('SELECT name FROM shops WHERE id = $1', [debt.shop_id]);
    if (shopRows[0]) shopName = shopRows[0].name;
  } else if (user.fullName) {
    shopName = user.fullName;
  }

  // Calculate remaining balance for this debtor
  const { rows: balanceRows } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'given' THEN (amount - paid_amount) ELSE 0 END), 0) AS given,
       COALESCE(SUM(CASE WHEN direction = 'taken' THEN (amount - paid_amount) ELSE 0 END), 0) AS taken
     FROM debts WHERE debtor_id = $1 AND status != 'paid'`,
    [debt.debtor_id]
  );

  const remainingBalance = Number(balanceRows[0]?.given || 0) + Number(balanceRows[0]?.taken || 0);

  const pngBuffer = generateReceiptPng({
    shopName,
    debtorName: debtor?.full_name || 'Mijoz',
    type: debt.direction || 'given',
    amount: Number(debt.amount),
    remainingBalance,
    date: new Date(debt.created_at || Date.now()).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }),
    receiptId: `QZ-${debt.id.substring(0, 6).toUpperCase()}`
  });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${debt.id}.png"`);
  res.send(pngBuffer);
});

