import { describe, expect, it } from 'vitest';
import { decide, displayName, type CustomerRef, type Decision } from '@nasiya/nlp';
import { t as translate } from '../../i18n/index.js';
import { renderDecision, type RenderContext } from './render.js';

const rc = (
  locale: 'uz-Latn' | 'uz-Cyrl' = 'uz-Latn',
  draftId: string | null = 'dr1',
): RenderContext => ({
  locale,
  t: (key, params) => translate(locale, key, params),
  draftId,
  supportLine: '',
});
const cust = (balance: number, name = 'Murod', label: string | null = null): CustomerRef => ({
  id: 'c1',
  name,
  normalizedName: name.toLowerCase(),
  label,
  normalizedLabel: label,
  balance,
});
const dec = (
  intent: Parameters<typeof decide>[0]['intent'],
  c: CustomerRef | null,
  writable = true,
): Decision =>
  decide({
    intent,
    resolution: c ? { kind: 'resolved', customer: c } : { kind: 'none' },
    writable,
  });
const base = { customer: 'murod', fraction: null, dateOffsetDays: 0 } as const;

describe('renderDecision: TT misollari', () => {
  it('§7 nasiya: Murodbek +450 000 so‘m [Saqlash][O‘zgartirish]', () => {
    const r = renderDecision(
      dec(
        { ...base, intent: 'CREATE_DEBT', amount: 450000, amountKind: 'ABSOLUTE' },
        cust(0, 'Murodbek'),
      ),
      rc(),
    )!;
    expect(r.text).toBe('Murodbek\n+450 000 so‘m\n\nQoldiq: 0 so‘m → 450 000 so‘m');
    expect(r.buttons[0]!.map((b) => b.text)).toEqual(['✅ Saqlash', '✏️ O‘zgartirish']);
    expect(r.buttons[0]![0]!.data).toBe('d:dr1:ok');
  });

  it('§8 to‘lov: To‘lov 200 000, Qoldiq 250 000', () => {
    const r = renderDecision(
      dec(
        { ...base, intent: 'CREATE_PAYMENT', amount: 200000, amountKind: 'ABSOLUTE' },
        cust(450000),
      ),
      rc(),
    )!;
    expect(r.text).toBe('Murod\n\nTo‘lov: 200 000 so‘m\nQoldiq: 250 000 so‘m');
  });

  it('§9 to‘liq to‘lov: “Qarzini to‘liq yopdimi?” [Ha, 450 000 so‘m][Boshqa summa][Bekor qilish]', () => {
    const r = renderDecision(
      dec({ ...base, intent: 'CREATE_PAYMENT', amount: null, amountKind: 'FULL' }, cust(450000)),
      rc(),
    )!;
    expect(r.text).toBe('Murodning hozirgi qarzi 450 000 so‘m.\n\nQarzini to‘liq yopdimi?');
    expect(r.buttons.flat().map((b) => b.text)).toEqual([
      'Ha, 450 000 so‘m',
      'Boshqa summa',
      '❌ Bekor qilish',
    ]);
  });

  it('§10 yarim to‘lov', () => {
    const r = renderDecision(
      dec(
        {
          ...base,
          intent: 'CREATE_PAYMENT',
          amount: null,
          amountKind: 'FRACTION',
          fraction: [1, 2],
        },
        cust(450000),
      ),
      rc(),
    )!;
    expect(r.text).toContain('Murodning qarzi: 450 000 so‘m.');
    expect(r.text).toContain('Yarmi: 225 000 so‘m.');
    expect(r.text).toContain('225 000 so‘m to‘lov sifatida yozilsinmi?');
  });

  it('§11 summa yo‘q → savol', () => {
    const r = renderDecision(
      dec({ ...base, intent: 'CREATE_DEBT', amount: null, amountKind: 'NONE' }, cust(0)),
      rc(),
    )!;
    expect(r.text).toContain('Qancha nasiya yozay?');
  });

  it('§12 noaniq mijoz: nomzodlar tugma, “+ Yangi mijoz”', () => {
    const d = decide({
      intent: { ...base, intent: 'CREATE_DEBT', amount: 50000, amountKind: 'ABSOLUTE' },
      resolution: {
        kind: 'ambiguous',
        candidates: [cust(100000, 'Murod', 'aka'), cust(0, 'Murodbek')],
        exactCount: 1,
      },
      writable: true,
    });
    const r = renderDecision(d, rc())!;
    expect(r.text).toBe('Qaysi mijozni nazarda tutdingiz?');
    expect(r.buttons.flat().map((b) => b.text)).toEqual([
      'Murod (aka) — 100 000 so‘m',
      'Murodbek — 0 so‘m',
      '➕ Yangi mijoz',
      '❌ Bekor qilish',
    ]);
    expect(r.buttons.flat().map((b) => b.data)).toEqual(['c:0', 'c:1', 'c:new', 'x:cancel']);
  });

  it('to‘lovda “Yangi mijoz” tugmasi yo‘q', () => {
    const d = decide({
      intent: { ...base, intent: 'CREATE_PAYMENT', amount: 50000, amountKind: 'ABSOLUTE' },
      resolution: {
        kind: 'ambiguous',
        candidates: [cust(100000), cust(5, 'Murodbek')],
        exactCount: 1,
      },
      writable: true,
    });
    expect(
      renderDecision(d, rc())!
        .buttons.flat()
        .map((b) => b.data),
    ).toEqual(['c:0', 'c:1', 'x:cancel']);
  });

  it('§29 ortiqcha to‘lov rad etiladi, eng ko‘pi bilan yozish taklif qilinadi', () => {
    const r = renderDecision(
      dec(
        { ...base, intent: 'CREATE_PAYMENT', amount: 150000, amountKind: 'ABSOLUTE' },
        cust(100000),
      ),
      rc(),
    )!;
    expect(r.text).toContain('Qarzi: 100 000 so‘m.');
    expect(r.text).toContain('150 000 so‘m to‘lovni qabul qilib bo‘lmaydi');
    expect(r.buttons.flat().map((b) => b.data)).toEqual(['o:max', 'o:other', 'x:cancel']);
    expect(r.buttons[0]![0]!.text).toBe('100 000 so‘m yozish');
  });

  it('katta summa ogohlantirishi', () => {
    const r = renderDecision(
      dec({ ...base, intent: 'CREATE_DEBT', amount: 60_000_000, amountKind: 'ABSOLUTE' }, cust(0)),
      rc(),
    )!;
    expect(r.text.startsWith('⚠️ Katta summa: 60 000 000 so‘m.')).toBe(true);
  });
});

describe('renderDecision: boshqa', () => {
  it('tugmalarsiz qoralama (draftId yo‘q) tasdiq tugmasi bermaydi', () => {
    const r = renderDecision(
      dec({ ...base, intent: 'CREATE_DEBT', amount: 1000, amountKind: 'ABSOLUTE' }, cust(0)),
      rc('uz-Latn', null),
    )!;
    expect(r.buttons).toEqual([]);
  });

  it('Kirill matn va valyuta', () => {
    const r = renderDecision(
      dec(
        { ...base, intent: 'CREATE_PAYMENT', amount: 200000, amountKind: 'ABSOLUTE' },
        cust(450000, 'Мурод'),
      ),
      rc('uz-Cyrl'),
    )!;
    expect(r.text).toBe('Мурод\n\nТўлов: 200 000 сўм\nҚолдиқ: 250 000 сўм');
    expect(r.buttons[0]![0]!.text).toBe('✅ Сақлаш');
  });

  it('callback ma’lumotlari 64 baytdan oshmaydi', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const r = renderDecision(
      dec({ ...base, intent: 'CREATE_PAYMENT', amount: null, amountKind: 'FULL' }, cust(5000)),
      rc('uz-Latn', uuid),
    )!;
    for (const b of r.buttons.flat()) expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(`m:${uuid}:hist`)).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(`delok:${uuid}`)).toBeLessThanOrEqual(64);
  });

  it('rad etishlar: qarz yo‘q, noma’lum mijoz, noto‘g‘ri summa, obuna', () => {
    expect(
      renderDecision(
        dec({ ...base, intent: 'CREATE_PAYMENT', amount: 1, amountKind: 'ABSOLUTE' }, cust(0)),
        rc(),
      )!.text,
    ).toBe('Murod: qarz yo‘q (0 so‘m). To‘lov yozib bo‘lmaydi.');
    expect(
      renderDecision(
        dec({ ...base, intent: 'CREATE_PAYMENT', amount: 1, amountKind: 'ABSOLUTE' }, null),
        rc(),
      )!.text,
    ).toContain('«murod» ismli mijoz topilmadi');
    expect(
      renderDecision(
        dec({ ...base, intent: 'CREATE_DEBT', amount: -5, amountKind: 'ABSOLUTE' }, cust(0)),
        rc(),
      )!.text,
    ).toContain('Summa noto‘g‘ri');
    const blocked = renderDecision(
      dec({ ...base, intent: 'CREATE_DEBT', amount: 5, amountKind: 'ABSOLUTE' }, cust(0), false),
      { ...rc(), supportLine: "To'lash uchun: +998907900110" },
    )!;
    expect(blocked.text).toBe(
      "Obuna muddati tugagan: yozish bloklangan, ko‘rish mumkin.\nTo'lash uchun: +998907900110",
    );
  });

  it('qoldiq ko‘rsatish va menyu tugmalari', () => {
    const d = dec(
      { ...base, intent: 'VIEW_CUSTOMER_BALANCE', amount: null, amountKind: 'NONE' },
      cust(450000),
    );
    const r = renderDecision(d, rc())!;
    expect(r.text).toBe('Murod\nQarz: 450 000 so‘m');
    expect(r.buttons[0]!.map((b) => b.data)).toEqual(['m:c1:debt', 'm:c1:pay', 'm:c1:hist']);
    expect(
      renderDecision(
        dec(
          { ...base, intent: 'VIEW_CUSTOMER_BALANCE', amount: null, amountKind: 'NONE' },
          cust(0),
        ),
        rc(),
      )!.text,
    ).toBe('Murod\nQarz yo‘q.');
  });

  it('displayName yorliq bilan', () => {
    expect(displayName({ name: 'Ali', label: 'qo‘shni' })).toBe('Ali (qo‘shni)');
    expect(translate('uz-Latn', 'cancelled')).toBe('Bekor qilindi.');
  });
});
