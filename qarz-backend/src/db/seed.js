import bcrypt from 'bcryptjs';
import { pool, query } from './pool.js';
import { normalizePhone } from '../utils/phone.js';

const seed = async () => {
  console.log('[seed] Seeding plans...');
  const plans = [
    { code: 'start', name: 'Start', price: 0, maxDebtors: 50, maxStaff: 0, sms: 30, adv: false },
    { code: 'pro', name: 'Pro', price: 99000, maxDebtors: 500, maxStaff: 2, sms: 100, adv: true },
    { code: 'business', name: 'Business', price: 249000, maxDebtors: null, maxStaff: 10, sms: 300, adv: true },
  ];
  for (const p of plans) {
    await query(
      `INSERT INTO plans (code, name, price_uzs, max_debtors, max_staff, monthly_sms, advanced_stats)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET
         name=EXCLUDED.name, price_uzs=EXCLUDED.price_uzs, max_debtors=EXCLUDED.max_debtors,
         max_staff=EXCLUDED.max_staff, monthly_sms=EXCLUDED.monthly_sms, advanced_stats=EXCLUDED.advanced_stats`,
      [p.code, p.name, p.price, p.maxDebtors, p.maxStaff, p.sms, p.adv]
    );
  }

  console.log('[seed] Creating super admin...');
  const phone = normalizePhone(process.env.SUPER_ADMIN_PHONE || '998900000000');
  const pass = process.env.SUPER_ADMIN_PASSWORD || 'admin12345';
  const hash = await bcrypt.hash(pass, 10);
  await query(
    `INSERT INTO users (role, phone, password_hash, full_name)
     VALUES ('super_admin', $1, $2, 'Platform Owner')
     ON CONFLICT (phone) DO NOTHING`,
    [phone, hash]
  );

  console.log(`[seed] Done ✔  Super admin: ${phone} / ${pass}`);
  await pool.end();
};

seed().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
