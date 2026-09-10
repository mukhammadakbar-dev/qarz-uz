import { Router } from 'express';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get('/sms-status', (_req, res) => {
  const configured = Boolean(config.eskiz.email && config.eskiz.password);
  res.json({ configured });
});

/**
 * Deployment facts the clients need in order to render honestly.
 *
 * Unauthenticated on purpose: the web app has to know whether to show payment
 * UI before anyone logs in, and the bot fetches it at startup with no user in
 * hand. Nothing here is a secret — it is a boolean and a public contact.
 */
router.get('/public', (_req, res) => {
  res.json({
    // Whether the online gateway can actually take money. Clients hide their
    // payment-link buttons when false instead of offering a broken link.
    clickEnabled: config.click.enabled,
    // Who to contact to pay for a subscription while renewals are manual.
    support: {
      telegram: config.support.telegram,
      phone: config.support.phone,
    },
  });
});

/**
 * Tariff list for the pricing page. Public: a shop owner whose subscription has
 * lapsed still needs to see what they are being asked to pay for, and prices
 * are marketing copy, not private data.
 */
router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT code, name, price_uzs, max_debtors, max_staff, monthly_sms, advanced_stats
       FROM plans ORDER BY price_uzs ASC`
    );
    res.json(rows);
  })
);

export default router;
