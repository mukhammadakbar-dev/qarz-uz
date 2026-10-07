#!/usr/bin/env node
// golden.jsonl ni yig‘adi: qo‘lda yozilgan holatlar + deterministik generatsiya qilingan matritsa.
// Ishga tushirish: node packages/nlp-eval/build-golden.mjs
// Generator tasodifiy emas: bir xil kod = bir xil fayl (diff'da ko‘rinadi).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handwritten } from './handwritten.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ── Ismlar: [Lotin, Kirill, normalize qilingan] ──
const names = [
  ['Murod', 'Мурод', 'murod'],
  ['Murodbek', 'Муродбек', 'murodbek'],
  ['Ali', 'Али', 'ali'],
  ['Vali', 'Вали', 'vali'],
  ['Sardor', 'Сардор', 'sardor'],
  ['Dilshod', 'Дилшод', 'dilshod'],
  ['Jasur', 'Жасур', 'jasur'],
  ['Bobur', 'Бобур', 'bobur'],
  ['Gulnora', 'Гулнора', 'gulnora'],
  ['Sherzod', 'Шерзод', 'sherzod'],
  ['Nodira', 'Нодира', 'nodira'],
  ['Otabek', 'Отабек', 'otabek'],
  ['Akmal', 'Акмал', 'akmal'],
  ['Zafar', 'Зафар', 'zafar'],
  ['Rustam', 'Рустам', 'rustam'],
  ['Kamola', 'Камола', 'kamola'],
  ['Hamid', 'Ҳамид', 'hamid'],
  ['Shahzod', 'Шаҳзод', 'shahzod'],
  ['Feruza', 'Феруза', 'feruza'],
  ['Sanjar', 'Санжар', 'sanjar'],
  ['G\'ayrat', 'Ғайрат', 'g\'ayrat'],
  ['O\'tkir', 'Ўткир', 'o\'tkir'],
];
const apostrophes = ['\'', 'ʻ', '‘', '’', '`'];

// ── Summalar: [Lotin, Kirill, qiymat] ──
const amounts = [
  ['50 ming', '50 минг', 50000],
  ['50ming', '50минг', 50000],
  ['50 000', '50 000', 50000],
  ['50000', '50000', 50000],
  ['50k', '50к', 50000],
  ['50 k', '50 к', 50000],
  ['50.000', '50.000', 50000],
  ['450 ming', '450 минг', 450000],
  ['450 000', '450 000', 450000],
  ['200 ming', '200 минг', 200000],
  ['100 ming', '100 минг', 100000],
  ['100 000 so‘m', '100 000 сўм', 100000],
  ['20 ming', '20 минг', 20000],
  ['30 ming', '30 минг', 30000],
  ['25 ming', '25 минг', 25000],
  ['75k', '75к', 75000],
  ['1 200 000', '1 200 000', 1200000],
  ['1,5 mln', '1,5 млн', 1500000],
  ['2 mln', '2 млн', 2000000],
  ['1 million', '1 миллион', 1000000],
  ['yarim million', 'ярим миллион', 500000],
  ['yuz ming', 'юз минг', 100000],
  ['ikki yuz ming', 'икки юз минг', 200000],
  ['besh ming', 'беш минг', 5000],
  ['500 so‘m', '500 сўм', 500],
  ['3 mln 500 ming', '3 млн 500 минг', 3500000],
  ['50 ming so‘m', '50 минг сўм', 50000],
  ['50000 so‘m', '50000 сўм', 50000],
];

// ── Fe'llar: [Lotin, Kirill] ──
const debtVerbs = [['yoz', 'ёз'], ['yozing', 'ёзинг'], ['yozib qo‘y', 'ёзиб қўй']];
const payVerbs = [['berdi', 'берди'], ['to‘ladi', 'тўлади'], ['qaytardi', 'қайтарди']];
const nasiya = ['nasiya', 'насия'];

// ── Skript rejimlari: [ism, summa, fe'l] ──
const modes = [
  ['L', 'L', 'L'], // Murod 50 ming berdi
  ['C', 'C', 'C'], // Мурод 50 минг берди
  ['L', 'C', 'L'], // Murod 50 минг berdi   (TT §6)
  ['C', 'L', 'L'], // Мурод 50 ming berdi   (TT §46)
  ['L', 'L', 'C'], // Murod 50 ming берди
];

const dativeSuffix = (str, script) => {
  const last = str.slice(-1).toLowerCase();
  if (script === 'L') return last === 'k' ? 'ka' : last === 'q' ? 'qa' : 'ga';
  return last === 'к' ? 'ка' : last === 'қ' ? 'қа' : 'га';
};

// Shablonlar: har biri {N} {Nd} {A} {V} {NS} (nasiya so‘zi) tokenlaridan iborat
const debtTemplates = [
  { t: '{N} {A}', tags: ['debt'] },
  { t: '{Nd} {A} {V}', tags: ['debt'], verb: 'debt' },
  { t: '{Nd} {A}', tags: ['debt'] },
  { t: '{N} {A} {NS}', tags: ['debt'] },
  { t: '{A} {N}', tags: ['debt', 'order'] },
  { t: '{Nd} {NS} {A}', tags: ['debt', 'order'] },
  { t: '{Nd} yana {A}', tags: ['debt', 'yana'], cyr: '{Nd} яна {A}' },
];
const payTemplates = [
  { t: '{N} {A} {V}', tags: ['payment'], verb: 'pay' },
  { t: '{N} {V} {A}', tags: ['payment', 'order'], verb: 'pay' },
  { t: '{N} {A} {V}', tags: ['payment'], verb: 'pay' },
];

const caseMode = (s, i) => (i % 6 === 1 ? s.toLowerCase() : i % 6 === 2 ? s.toUpperCase() : s);

const generated = [];
const seen = new Set();
const N = 170;
for (let i = 0; generated.length < N && i < N * 4; i++) {
  const [nameLat, nameCyr, nameNorm] = names[i % names.length];
  const am = amounts[(i * 7 + (i >> 3)) % amounts.length];
  const mode = modes[i % modes.length];
  const isPay = i % 5 < 2; // ~40% to‘lov
  const tpls = isPay ? payTemplates : debtTemplates;
  const tpl = tpls[(i * 3 + (i >> 2)) % tpls.length];

  const nameScript = mode[0];
  const amtScript = mode[1];
  const verbScript = mode[2];

  let nameStr = nameScript === 'L' ? nameLat : nameCyr;
  if (nameScript === 'L' && nameLat.includes('\'')) {
    nameStr = nameLat.replace(/'/g, apostrophes[i % apostrophes.length]);
  }
  const nameDat = nameStr + dativeSuffix(nameStr, nameScript);
  const amtStr = amtScript === 'L' ? am[0] : am[1];
  const verbs = tpl.verb === 'pay' ? payVerbs : debtVerbs;
  const verbPair = verbs[(i >> 1) % verbs.length];
  const verbStr = verbScript === 'L' ? verbPair[0] : verbPair[1];
  const nsStr = verbScript === 'L' ? nasiya[0] : nasiya[1];

  let t = verbScript === 'C' && tpl.cyr ? tpl.cyr : tpl.t;
  if (!tpl.cyr && verbScript === 'C') t = t.replace('yana', 'яна');
  let text = t
    .replace('{Nd}', nameDat)
    .replace('{N}', nameStr)
    .replace('{A}', amtStr)
    .replace('{V}', verbStr)
    .replace('{NS}', nsStr);

  text = caseMode(text, i);
  if (i % 9 === 0) text += '.';
  else if (i % 11 === 0) text += ' 👍';
  else if (i % 13 === 0) text = text.replace(' ', '  ');

  if (seen.has(text)) continue;
  seen.add(text);

  const intent = isPay ? 'CREATE_PAYMENT' : 'CREATE_DEBT';
  generated.push({
    input: text,
    tags: ['generated', ...tpl.tags, `mode-${mode.join('')}`],
    expect: {
      intent,
      customer: nameNorm,
      amount: am[2],
      amount_kind: 'ABSOLUTE',
      fraction: null,
      date_offset_days: 0,
    },
  });
}

// Qo‘lda yozilganlar hammasi `expect` ni to‘liq qilib to‘ldiriladi, ID beriladi.
const all = [...handwritten.map((c) => ({ ...c, src: 'hw' })), ...generated.map((c) => ({ ...c, src: 'gen' }))];
const counters = { hw: 0, gen: 0 };
const lines = all.map((c) => {
  counters[c.src]++;
  const id = `${c.src === 'hw' ? 'HW' : 'GEN'}-${String(counters[c.src]).padStart(4, '0')}`;
  const { src, ...rest } = c;
  return JSON.stringify({ id, ...rest });
});

writeFileSync(join(here, 'golden.jsonl'), lines.join('\n') + '\n');
console.log(`golden.jsonl: ${lines.length} holat (qo‘lda: ${counters.hw}, generatsiya: ${counters.gen})`);
