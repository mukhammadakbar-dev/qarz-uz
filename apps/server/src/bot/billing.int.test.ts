import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Person } from '../../test/bot-harness.js';

/**
 * T5.1 + T5.3: superadmin bot buyruqlari va obuna holatlari bo'yicha to'liq oqim:
 * TRIAL → EXPIRED (yozish bloklanadi, o'qish ishlaydi) → /sub → "+1 oy" → tasdiq → ACTIVE → yozish ishlaydi.
 */

const ADMIN_TG = 6_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
let h: Harness;
let admin: Person;

beforeAll(async () => {
  h = await createHarness({ superadminIds: [ADMIN_TG] });
  admin = h.person('Admin', ADMIN_TG);
});
afterAll(async () => {
  await h.close();
});

const codeOf = async (p: Person) =>
  (await h.sys.query('SELECT short_code FROM businesses WHERE id = $1', [await h.businessId(p)]))
    .rows[0].short_code as string;
const payments = async (p: Person) =>
  (
    await h.sys.query(
      'SELECT amount::int, months, note FROM subscription_payments WHERE business_id = $1 ORDER BY created_at',
      [await h.businessId(p)],
    )
  ).rows;
const expire = async (p: Person) =>
  h.sys.query(
    "UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour' WHERE business_id = $1",
    [await h.businessId(p)],
  );

describe('superadmin buyruqlari: kirish', () => {
  it('oddiy foydalanuvchi uchun buyruqlar mavjud emasdek (“Tushunmadim”), tugmalar e’tiborsiz', async () => {
    const owner = await h.owner('Oddiy');
    const code = await codeOf(owner);
    for (const cmd of [`/sub ${code}`, `/extend ${code} 1`, '/expiring']) {
      await owner.text(cmd);
      expect(owner.last()).toContain('Tushunmadim');
    }
    const mark = owner.mark();
    await owner.press(`as:${await h.businessId(owner)}:1`);
    await owner.press('ae:AAAAAAAA');
    expect(owner.since(mark)).toEqual([]);
    expect(await payments(owner)).toEqual([]);
  });
});

describe('T5.3: TRIAL → EXPIRED → uzaytirish → ACTIVE', () => {
  it('to‘liq oqim', async () => {
    const owner = await h.owner('Sardor');
    const code = await codeOf(owner);

    // TRIAL: yozish ishlaydi
    await owner.text('Murod 50 ming');
    await owner.pressLabel('Saqlash');
    expect(owner.last()).toContain('nasiya yozildi');

    // EXPIRED: yozish bloklanadi, uzaytirish tugmasi; o'qish ishlaydi
    await expire(owner);
    await owner.text('Murod 20 ming berdi');
    expect(owner.last()).toContain('Obuna muddati tugagan');
    expect(owner.buttons().map((b) => b.text)).toEqual(['💳 Obunani uzaytirish']);
    await owner.text('Murod qancha qarz?');
    expect(owner.last()).toContain('50 000 so‘m');

    // Superadmin: holat kartasi
    await admin.text(`/sub ${code}`);
    expect(admin.last()).toContain(`«Sardor do‘koni» — ${code}`);
    expect(admin.last()).toContain('muddati tugagan');
    expect(admin.last()).toContain('Mijozlar: 1 · jami qarz: 50 000 so‘m');
    expect(admin.buttons().map((b) => b.text)).toEqual(['+1 oy', '+3 oy', '+6 oy', '+12 oy']);

    // "+1 oy" → tasdiq → uzaytirildi, egasiga xabar
    await admin.pressLabel('+1 oy');
    expect(admin.last()).toContain('obunasini 1 oyga uzaytiraymi?');
    expect(admin.last()).toContain('Summa: 29 000 so‘m');
    const ownerMark = owner.mark();
    await admin.pressLabel('Ha, uzaytirish');
    expect(admin.last()).toContain('gacha uzaytirildi (29 000 so‘m qayd etildi)');
    expect(
      owner.since(ownerMark).some((m) => m.includes('obunasi') && m.includes('uzaytirildi')),
    ).toBe(true);
    expect(await payments(owner)).toEqual([{ amount: 29000, months: 1, note: null }]);

    // ACTIVE: yozish yana ishlaydi
    await owner.text('Murod 20 ming berdi');
    await owner.pressLabel('Saqlash');
    expect(owner.last()).toContain('Qoldiq: 30 000 so‘m');

    const audit = await h.sys.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE business_id = $1 AND action = 'billing.extend'",
      [await h.businessId(owner)],
    );
    expect(audit.rows[0].n).toBe(1);
  });
});

describe('/extend: tasdiq bir martalik', () => {
  it('ikki marta bosish — bitta uzaytirish; izoh saqlanadi', async () => {
    const owner = await h.owner('Ikki');
    const code = await codeOf(owner);
    await admin.text(`/extend ${code.toLowerCase()} 2 naqd pul`);
    expect(admin.last()).toContain('obunasini 2 oyga uzaytiraymi?');
    expect(admin.last()).toContain('Izoh: naqd pul');
    const confirm = admin.buttons().find((b) => b.text.includes('Ha'))!.data!;
    await admin.press(confirm);
    await admin.press(confirm);
    expect(admin.last()).toContain('eskirgan');
    expect(await payments(owner)).toEqual([{ amount: 58000, months: 2, note: 'naqd pul' }]);
  });

  it('tasdiq so‘ralgandan keyin obuna boshqa yo‘l bilan uzaytirilsa — rad etiladi', async () => {
    const owner = await h.owner('Parallel');
    const code = await codeOf(owner);
    await admin.text(`/extend ${code} 1`);
    // Oraliqda (masalan, Mini App panelidan) uzaytirildi
    await h.sys.query(
      "UPDATE subscriptions SET paid_until = trial_ends_at + interval '1 month' WHERE business_id = $1",
      [await h.businessId(owner)],
    );
    await admin.pressLabel('Ha, uzaytirish');
    expect(admin.last()).toContain('eskirgan');
    expect(await payments(owner)).toEqual([]);
  });

  it('“Bekor qilish” dan keyin eski tasdiq ishlamaydi', async () => {
    const owner = await h.owner('Bekor');
    await admin.text(`/extend ${await codeOf(owner)} 1`);
    const confirm = admin.buttons().find((b) => b.text.includes('Ha'))!.data!;
    await admin.pressLabel('Bekor qilish');
    expect(admin.last()).toBe('Bekor qilindi.');
    await admin.press(confirm);
    expect(admin.last()).toContain('eskirgan');
    expect(await payments(owner)).toEqual([]);
  });

  it('noto‘g‘ri buyruqlar: foydalanish yo‘riqnomasi va topilmagan kod', async () => {
    await admin.text('/extend');
    expect(admin.last()).toContain('Foydalanish: /extend');
    await admin.text('/extend TD-ZZZZ 0');
    expect(admin.last()).toContain('Foydalanish: /extend');
    await admin.text('/extend TD-ZZZZ 1');
    expect(admin.last()).toBe('«TD-ZZZZ» kodli do‘kon topilmadi.');
    await admin.text('/sub');
    expect(admin.last()).toBe('Foydalanish: /sub TD-XXXX');
  });
});

describe('/expiring', () => {
  it('yaqin kunlarda tugaydiganlar ro‘yxati', async () => {
    const owner = await h.owner('Tugaydi');
    const code = await codeOf(owner);
    await h.sys.query(
      "UPDATE subscriptions SET trial_ends_at = now() + interval '36 hours' WHERE business_id = $1",
      [await h.businessId(owner)],
    );
    await admin.text('/expiring 3');
    expect(admin.last()).toContain('⏳ 3 kun ichida tugaydi:');
    expect(admin.last()).toMatch(
      new RegExp(
        `${code} «Tugaydi do‘koni» — 2 kun \\(\\d{2}\\.\\d{2}\\.\\d{4}\\) · Tugaydi · sinov`,
      ),
    );
  });
});
