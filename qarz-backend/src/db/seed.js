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

  console.log('[seed] Creating / updating super admin...');
  const phone = normalizePhone(process.env.SUPER_ADMIN_PHONE || '998900000000');
  const pass = process.env.SUPER_ADMIN_PASSWORD;

  // 'admin12345' is published in .env.example, so falling back to it in
  // production would hand the platform's highest-privilege account to anyone
  // who has read the repository.
  if (!pass) {
    console.error('[seed] SUPER_ADMIN_PASSWORD is not set. Refusing to seed a default password.');
    console.error('[seed] Set it in the environment, e.g. SUPER_ADMIN_PASSWORD="$(openssl rand -base64 24)"');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && pass.length < 12) {
    console.error('[seed] SUPER_ADMIN_PASSWORD must be at least 12 characters in production.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(pass, 10);
  
  const updated = await query(
    `UPDATE users SET phone = $1, password_hash = $2, updated_at = now()
     WHERE role = 'super_admin'
     RETURNING id`,
    [phone, hash]
  );
  if (updated.rows.length === 0) {
    await query(
      `INSERT INTO users (role, phone, password_hash, full_name)
       VALUES ('super_admin', $1, $2, 'Platform Owner')
       ON CONFLICT (phone) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [phone, hash]
    );
  }

  // Never echo the password: seed output lands in CI logs and shell history.
  console.log(`[seed] Done ✔  Super admin: ${phone} (password taken from SUPER_ADMIN_PASSWORD)`);
  await pool.end();
};

seed().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
