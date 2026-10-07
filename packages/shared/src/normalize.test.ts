import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeName, normalizeText } from './normalize.js';

describe('normalizeText', () => {
  it('TT §20: ism variantlari bir xil qiymat beradi', () => {
    for (const v of ['Murod', 'murod', 'MUROD', 'Мурод', 'мурод'])
      expect(normalizeText(v)).toBe('murod');
  });

  it('TT §20: summa variantlari (Kirill → Lotin)', () => {
    expect(normalizeText('50 минг')).toBe('50 ming');
    expect(normalizeText('50минг')).toBe('50ming');
    expect(normalizeText('50к')).toBe('50k');
    expect(normalizeText('1,5 млн')).toBe('1,5 mln');
    expect(normalizeText('ярим миллион')).toBe('yarim million');
  });

  it('aralash yozuv (AC-04)', () => {
    const a = normalizeText('Murod 50 ming berdi');
    expect(normalizeText('Мурод 50 минг берди')).toBe(a);
    expect(normalizeText('Murod 50 минг berdi')).toBe(a);
    expect(normalizeText('Мурод 50 ming берди')).toBe(a);
  });

  it('o‘zbek kirill harflari', () => {
    expect(normalizeText('Ўткир Ғайрат Қодир Ҳамид')).toBe("o'tkir g'ayrat qodir hamid");
    expect(normalizeText('Шаҳзод Жасур Чориев')).toBe('shahzod jasur choriev');
    expect(normalizeText('Юсуф Ёқуб Яхё')).toBe('yusuf yoqub yaxyo');
  });

  it('so‘z boshidagi "е" → "ye", boshqa joyda "e"', () => {
    expect(normalizeText('Елена')).toBe('yelena');
    expect(normalizeText('Бекзод')).toBe('bekzod');
    expect(normalizeText('Элдор')).toBe('eldor');
  });

  it('apostrof variantlari bitta ASCII apostrofga birlashadi', () => {
    for (const a of ["'", 'ʻ', 'ʼ', '‘', '’', '`', '´']) {
      expect(normalizeText(`G${a}ayrat to${a}ladi`), a).toBe("g'ayrat to'ladi");
    }
    expect(normalizeText('маъно')).toBe("ma'no");
  });

  it('so‘z chetidagi apostrof (qo‘shtirnoq o‘rnida) olib tashlanadi', () => {
    expect(normalizeText("'Murod' 50 ming")).toBe('murod 50 ming');
    expect(normalizeText("Murod'")).toBe('murod');
  });

  it('homoglif: Lotin so‘zdagi Kirill harflari tuzaladi', () => {
    expect(normalizeText('Мurod')).toBe('murod'); // Kirill М
    expect(normalizeText('Murоd')).toBe('murod'); // Kirill о
  });

  it('raqamlar va tinish belgilari saqlanadi (summa tahlili uchun)', () => {
    expect(normalizeText('1.200.000 so‘m')).toBe("1.200.000 so'm");
    expect(normalizeText('50,000')).toBe('50,000');
  });

  it('bo‘shliqlar va emoji', () => {
    expect(normalizeText('  Murod \n 50\t ming  ')).toBe('murod 50 ming');
    expect(normalizeText('Murod 👍')).toBe('murod 👍');
  });
});

describe('normalizeName', () => {
  it('belgilarni tozalaydi, harf/raqam/apostrof/defis qoladi', () => {
    expect(normalizeName('  Мурод (ака)!  ')).toBe('murod ака'.replace('ака', 'aka'));
    expect(normalizeName('Ali-Vali')).toBe('ali-vali');
    expect(normalizeName("O'tkir #2")).toBe("o'tkir 2");
    expect(normalizeName('Murod 🙂')).toBe('murod');
  });

  it('bo‘sh natija bo‘lishi mumkin (faqat belgilar)', () => {
    expect(normalizeName('!!! ???')).toBe('');
  });
});

describe('property testlar', () => {
  it('idempotent: normalize(normalize(x)) = normalize(x)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (s) => {
        expect(normalizeText(normalizeText(s))).toBe(normalizeText(s));
        expect(normalizeName(normalizeName(s))).toBe(normalizeName(s));
      }),
      { numRuns: 500 },
    );
  });

  it('hech qachon xato bermaydi, natijada Kirill (o‘zbek) harflari qolmaydi', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (s) => {
        expect(normalizeText(s)).not.toMatch(/[а-яёўқғҳ]/);
      }),
      { numRuns: 500 },
    );
  });

  it('normalizeName natijasi faqat ruxsat etilgan belgilardan iborat', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (s) => {
        expect(normalizeName(s)).toMatch(/^[\p{L}\p{N}' -]*$/u);
        expect(normalizeName(s)).toBe(normalizeName(s).trim());
      }),
      { numRuns: 500 },
    );
  });
});
