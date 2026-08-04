import bcrypt from 'bcryptjs';
import { query, pool } from './pool.js';
import { normalizePhone } from '../utils/phone.js';

async function main() {
  // Both of these were previously hardcoded defaults — a real phone number and
  // a working super-admin password committed to the repository. Anyone with
  // read access to the source could log in as the platform owner on any
  // deployment where this script had been run.
  const phone = normalizePhone(process.env.SUPER_ADMIN_PHONE);
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!phone) {
    console.error('[reset-admin] SUPER_ADMIN_PHONE is not set or is not a valid Uzbek number.');
    process.exit(1);
  }
  if (!password || password.length < 12) {
    console.error('[reset-admin] SUPER_ADMIN_PASSWORD must be set and at least 12 characters.');
    console.error('[reset-admin] e.g. SUPER_ADMIN_PASSWORD="$(openssl rand -base64 24)"');
    process.exit(1);
  }

  console.log(`[reset-admin] Super admin paroli va telefoni yangilanmoqda (${phone})...`);

  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await query(`SELECT id, role FROM users WHERE phone = $1`, [phone]);

  if (existing.rows.length > 0) {
    await query(`DELETE FROM users WHERE role = 'super_admin' AND phone != $1`, [phone]);
    await query(
      `UPDATE users SET role = 'super_admin', password_hash = $1, updated_at = now()
       WHERE phone = $2`,
      [passwordHash, phone]
    );
    console.log(`[reset-admin] Super admin (${phone}) muvaffaqiyatli yangilandi va super_admin roliga o'tkazildi! ✔`);
  } else {
    const updated = await query(
      `UPDATE users SET phone = $1, password_hash = $2, updated_at = now()
       WHERE role = 'super_admin'
       RETURNING id`,
      [phone, passwordHash]
    );
    if (updated.rows.length === 0) {
      await query(
        `INSERT INTO users (role, phone, password_hash, full_name)
         VALUES ('super_admin', $1, $2, 'Platform Owner')`,
        [phone, passwordHash]
      );
    }
    console.log(`[reset-admin] Super admin (${phone}) muvaffaqiyatli yangilandi! ✔`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[reset-admin] Xatolik:', err);
  process.exit(1);
});

