import { normalizeName } from '@nasiya/shared';
import { describe, expect, it } from 'vitest';
import { displayName, resolveCustomer, type CustomerRef } from './resolver.js';

const ref = (id: string, name: string, label: string | null = null, balance = 0): CustomerRef => ({
  id,
  name,
  normalizedName: normalizeName(name),
  label,
  normalizedLabel: label ? normalizeName(label) : null,
  balance,
});

const ids = (r: ReturnType<typeof resolveCustomer>) =>
  r.kind === 'ambiguous'
    ? r.candidates.map((c) => c.id)
    : r.kind === 'resolved'
      ? [r.customer.id]
      : [];

describe('resolveCustomer', () => {
  const murod = ref('murod', 'Murod');
  const murodbek = ref('murodbek', 'Murodbek');
  const ali = ref('ali', 'Ali');
  const vali = ref('vali', 'Vali');

  it('bitta aniq moslik va boshqa nomzod yo‘q → resolved', () => {
    expect(resolveCustomer('murod', null, [murod, ali])).toEqual({
      kind: 'resolved',
      customer: murod,
    });
  });

  it('Lotin/Kirill va registr farqi yo‘q', () => {
    const kirill = ref('k', 'Мурод');
    expect(resolveCustomer('murod', null, [kirill]).kind).toBe('resolved');
  });

  it('faqat prefiks (Murod ↔ Murodbek) → har doim savol', () => {
    expect(resolveCustomer('murod', null, [murodbek])).toMatchObject({
      kind: 'ambiguous',
      exactCount: 0,
    });
    expect(ids(resolveCustomer('murod', null, [murod, murodbek]))).toEqual(['murod', 'murodbek']);
    expect(resolveCustomer('murodbek', null, [murod])).toMatchObject({ kind: 'ambiguous' }); // teskari prefiks
  });

  it('bir xil ismli ikki mijoz → savol, yorliq bilan to‘liq nom aniqlaydi', () => {
    const aka = ref('aka', 'Murod', 'aka');
    const qoshni = ref('q', 'Murod', 'qo‘shni');
    expect(resolveCustomer('murod', null, [aka, qoshni]).kind).toBe('ambiguous');
    expect(resolveCustomer('murod aka', null, [aka, qoshni])).toEqual({
      kind: 'resolved',
      customer: aka,
    });
    expect(resolveCustomer("murod qo'shni", null, [aka, qoshni])).toEqual({
      kind: 'resolved',
      customer: qoshni,
    });
  });

  it('qisqa ismlar noto‘g‘ri fuzzy mos kelmaydi (Ali ↔ Vali)', () => {
    expect(resolveCustomer('ali', null, [vali]).kind).toBe('none');
    expect(resolveCustomer('ali', null, [ali, vali])).toEqual({ kind: 'resolved', customer: ali });
  });

  it('uzun ismlarda bitta harf xatosi → avtomatik emas, savol', () => {
    const r = resolveCustomer('sardar', null, [ref('s', 'Sardor')]);
    expect(r).toMatchObject({ kind: 'ambiguous', exactCount: 0 });
    expect(resolveCustomer('sarxxr', null, [ref('s', 'Sardor')]).kind).toBe('none'); // ikki harf farqi
  });

  it('qo‘shimcha noto‘g‘ri kesilgan bo‘lsa alt shakl bilan topiladi (Olga)', () => {
    const olga = ref('o', 'Olga');
    expect(resolveCustomer('ol', 'olga', [olga])).toEqual({ kind: 'resolved', customer: olga });
  });

  it('ismga yopishgan noma’lum so‘z: token tashlab topiladi, lekin hech qachon avtomatik tanlanmaydi', () => {
    const r = resolveCustomer('murod ber', null, [murod]);
    expect(r).toMatchObject({ kind: 'ambiguous', exactCount: 0 });
    expect(ids(r)).toEqual(['murod']);
  });

  it('“Ali Valiyev” → “Ali” ga avtomatik biriktirilmaydi', () => {
    expect(resolveCustomer('ali valiyev', null, [ali]).kind).toBe('ambiguous');
  });

  it('hech kim yo‘q → none', () => {
    expect(resolveCustomer('hasan', null, [murod, ali])).toEqual({ kind: 'none' });
    expect(resolveCustomer('hasan', null, [])).toEqual({ kind: 'none' });
  });

  it('nomzodlar soni cheklangan', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ref(`c${i}`, `Murod${String.fromCharCode(97 + i)}`),
    );
    expect(ids(resolveCustomer('murod', null, many))).toHaveLength(8);
  });

  it('displayName', () => {
    expect(displayName({ name: 'Murod', label: 'aka' })).toBe('Murod (aka)');
    expect(displayName({ name: 'Murod', label: null })).toBe('Murod');
  });
});
