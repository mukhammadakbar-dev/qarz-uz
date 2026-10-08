import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Person } from '../../test/bot-harness.js';
import { createCustomer } from '../modules/customers/index.js';
import { getBalance, postDebt } from '../modules/ledger/index.js';
import { setState } from '../modules/conversation/state.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ miniAppUrl: 'https://nasiya.example.uz/app' });
});
afterAll(async () => {
  await h.close();
});

type RawMarkup = {
  keyboard?: { text: string }[][];
  inline_keyboard?: { text: string; callback_data?: string; url?: string }[][];
};
const markupOf = (p: Person): RawMarkup =>
  (p.messages().at(-1)?.markup ?? {}) as unknown as RawMarkup;
const replyKeys = (p: Person) => markupOf(p).keyboard?.map((row) => row.map((b) => b.text));
const lastEdit = () => h.sent.filter((s) => s.method === 'editMessageText').at(-1)?.payload;

const shortCode = async (p: Person): Promise<string> =>
  (await h.sys.query('SELECT short_code FROM businesses WHERE id = $1', [await h.businessId(p)]))
    .rows[0].short_code as string;

async function shop(lang: 'uz-Latn' | 'uz-Cyrl' = 'uz-Latn') {
  const name = `Ega${randomUUID().slice(0, 4)}`;
  const owner = await h.owner(name, `${name} do‘koni`, lang);
  const access = await h.access(owner);
  return {
    owner,
    async customer(cname: string, debt = 0) {
      const c = await createCustomer(h.pool, access, { name: cname });
      if (debt) await this.debt(c.id, debt);
      return c.id;
    },
    debt: (customerId: string, amount: number) =>
      postDebt(h.pool, access, {
        customerId,
        amount,
        idempotencyKey: randomUUID(),
        source: 'SYSTEM',
      }),
    balance: (id: string) => getBalance(h.pool, access, id),
  };
}

describe('pastki klaviatura', () => {
  it('biznes yaratilgach 3 qatorli klaviatura o‘rnatiladi', async () => {
    const s = await shop();
    expect(s.owner.last()).toContain('yaratildi');
    expect(replyKeys(s.owner)).toEqual([
      ['➕ Nasiya', '💵 To‘lov'],
      ['👥 Qarzdorlar', '💳 Obuna'],
      ['🌐 Til / Тил', '❓ Qo‘llanma'],
    ]);
  });

  it('til almashtirilsa klaviatura yangi yozuvda qayta yuboriladi; eski yozuv tugmasi ham ishlaydi', async () => {
    const s = await shop();
    await s.customer('Murod', 50_000);
    await s.owner.text('🌐 Til / Тил');
    await s.owner.press('lang:uz-Cyrl');
    expect(replyKeys(s.owner)?.[1]).toEqual(['👥 Қарздорлар', '💳 Обуна']);

    await s.owner.text('👥 Қарздорлар');
    expect(s.owner.last()).toContain('Қарздорлар: 1 та');
    // Ekranda hali Lotin klaviaturasi qolgan bo'lishi mumkin
    await s.owner.text('👥 Qarzdorlar');
    expect(s.owner.last()).toContain('Қарздорлар: 1 та');
  });

  it('biznesi yo‘q odam tugmani bossa onboarding boshlanadi', async () => {
    const p = h.person('Yangi');
    await p.text('👥 Qarzdorlar');
    expect(p.last()).toContain('Tilni tanlang');
  });

  it('tugma bosilsa yorliq kutish bekor bo‘ladi (keyingi matn yorliq deb olinmaydi)', async () => {
    const s = await shop();
    await setState(h.pool, await h.userId(s.owner), 'AWAIT_LABEL', { name: 'Murod', phone: null });
    await s.owner.text('❓ Qo‘llanma');
    await s.owner.text('qo‘shni');
    expect(s.owner.last()).not.toContain('Mijoz yaratildi');
  });
});

describe('Nasiya va To‘lov tugmalari', () => {
  it('Nasiya: oxirgi faol mijozlar birinchi; tanlash → summa → tasdiq → yoziladi', async () => {
    const s = await shop();
    const ali = await s.customer('Ali', 10_000);
    await s.customer('Murod', 20_000);
    await s.debt(ali, 5_000); // Ali eng oxirgi faol

    await s.owner.text('➕ Nasiya');
    expect(s.owner.last()).toContain('Kimga nasiya yozamiz?');
    expect(s.owner.buttons().map((b) => b.text)).toEqual(['Ali', 'Murod', '➕ Yangi mijoz']);

    await s.owner.pressLabel('Ali');
    expect(s.owner.last()).toContain('Qancha nasiya yozay?');
    await s.owner.text('100 ming');
    await s.owner.pressLabel('Saqlash');
    expect(s.owner.last()).toContain('100 000 so‘m nasiya yozildi');
    expect(await s.balance(ali)).toBe(115_000);
  });

  it('“Yangi mijoz” yo‘riqnoma beradi; mijoz yo‘q bo‘lsa ham yo‘riqnoma', async () => {
    const s = await shop();
    await s.owner.text('➕ Nasiya');
    expect(s.owner.last()).toContain('Hali mijoz yo‘q');
    await s.customer('Murod');
    await s.owner.text('➕ Nasiya');
    await s.owner.pressLabel('Yangi mijoz');
    expect(s.owner.last()).toContain('Aziz 50 ming');
  });

  it('To‘lov: faqat qarzdorlar, qoldig‘i bilan; qarzdor yo‘q bo‘lsa aytiladi', async () => {
    const s = await shop();
    await s.customer('Vali');
    await s.owner.text('💵 To‘lov');
    expect(s.owner.last()).toContain('hech kimda qarz yo‘q');

    const murod = await s.customer('Murod', 450_000);
    await s.owner.text('💵 To‘lov');
    expect(s.owner.buttons().map((b) => b.text)).toEqual(['Murod · 450 000 so‘m']);
    await s.owner.pressLabel('Murod');
    await s.owner.text('200 ming');
    await s.owner.pressLabel('Saqlash');
    expect(await s.balance(murod)).toBe(250_000);
  });
});

describe('Qarzdorlar', () => {
  it('ro‘yxat, jami va har bir mijoz uchun tugma; tugma mijoz kartasini ochadi', async () => {
    const s = await shop();
    await s.customer('Murod', 450_000);
    await s.customer('Ali', 250_000);
    await s.customer('Vali');
    await s.owner.text('👥 Qarzdorlar');
    const t = s.owner.last();
    expect(t).toContain('Qarzdorlar: 2 ta, jami 700 000 so‘m');
    expect(t).toContain('1. Murod — 450 000 so‘m');
    expect(t).toContain('2. Ali — 250 000 so‘m');
    expect(t).not.toContain('Vali');
    expect(s.owner.buttons().map((b) => b.text)).toEqual([
      '1. Murod',
      '2. Ali',
      '📱 Ilovani ochish',
    ]);

    await s.owner.pressLabel('2. Ali');
    expect(s.owner.last()).toContain('Ali\nQarz: 250 000 so‘m');
    expect(s.owner.buttons().map((b) => b.text)).toEqual([
      '➕ Nasiya',
      '💵 To‘lov',
      '🕘 Tarix',
      '📱 Ilovani ochish',
    ]);
  });

  it('/qarzdorlar buyrug‘i ham ishlaydi; bo‘sh ro‘yxat', async () => {
    const s = await shop();
    await s.owner.text('/qarzdorlar');
    expect(s.owner.last()).toContain('qarzdorlar yo‘q');
  });

  it('boshqa biznes mijozining kartasini ochib bo‘lmaydi', async () => {
    const a = await shop();
    const b = await shop();
    const foreign = await b.customer('Sir', 1_000);
    await a.owner.press(`v:${foreign}`);
    expect(a.owner.last()).toContain('Mijoz topilmadi');
  });
});

describe('Obuna', () => {
  it('holat, narx, biznes kodi; uzaytirish tugmasi admin chatini tayyor xabar bilan ochadi', async () => {
    const s = await shop();
    const code = await shortCode(s.owner);
    await s.owner.text('💳 Obuna');
    const t = s.owner.last();
    expect(t).toContain('Holat: sinov muddati');
    expect(t).toContain('oyiga 29 000 so‘m');
    expect(t).toContain(`Biznes kodi: ${code}`);
    expect(t).toContain('+998907900110');
    const rows = markupOf(s.owner).inline_keyboard ?? [];
    const renew = rows.flat().find((b) => b.url);
    expect(renew?.text).toBe('💳 Obunani uzaytirish');
    const url = new URL(renew!.url!);
    expect(url.origin + url.pathname).toBe('https://t.me/+998907900110');
    expect(url.searchParams.get('text')).toBe(
      `Assalomu alaykum! Obuna muddatini uzaytirmoqchiman. ID: \`${code}\``,
    );

    await s.owner.pressLabel('Xodim taklif qilish');
    expect(s.owner.last()).toMatch(/https:\/\/t\.me\/kissauzbot\?start=inv_/);
  });

  it('Kirill foydalanuvchida xabar ham Kirillda', async () => {
    const s = await shop('uz-Cyrl');
    await s.owner.text('💳 Обуна');
    const renew = (markupOf(s.owner).inline_keyboard ?? []).flat().find((b) => b.url);
    expect(renew?.text).toBe('💳 Обунани узайтириш');
    expect(new URL(renew!.url!).searchParams.get('text')).toContain(
      'Ассалому алайкум! Обуна муддатини узайтирмоқчиман.',
    );
  });

  it('xodimga taklif tugmasi ko‘rinmaydi', async () => {
    const s = await shop();
    const staff = await h.staff(s.owner, 'Dilnoza');
    await staff.text('/obuna');
    expect(staff.last()).toContain('💳 Obuna');
    expect(staff.buttons().map((b) => b.text)).not.toContain('👤 Xodim taklif qilish');
  });
});

describe('Qo‘llanma', () => {
  it('mavzular ro‘yxati; mavzu bir xabar ichida ochiladi va orqaga qaytadi', async () => {
    const s = await shop();
    await s.owner.text('❓ Qo‘llanma');
    expect(s.owner.last()).toContain('Kissa qanday ishlaydi');
    expect(s.owner.buttons().map((b) => b.data)).toEqual([
      'g:debt',
      'g:payment',
      'g:view',
      'g:delete',
      'g:staff',
      'g:subscription',
    ]);

    await s.owner.press('g:subscription');
    expect(lastEdit()?.['text']).toContain('14 kun bepul sinov, keyin oyiga 29 000 so‘m');
    await s.owner.press('g:home');
    expect(lastEdit()?.['text']).toContain('Mavzuni tanlang');
  });
});
