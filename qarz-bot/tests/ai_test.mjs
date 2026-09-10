import { parseHeuristic, calculateDueDate } from '../src/lib/ai.js';

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

console.log('--- AI Natural Language Parsing (Heuristic Parser) ---');

// Set fixed reference date: Tuesday, 2026-09-08
const fixedNow = new Date('2026-09-08T10:00:00Z');

// Test 1: "falonchi 100ming som dushanba deb yozsa"
let res = parseHeuristic('falonchi 100ming som dushanba deb yozsa', fixedNow);
P('test 1 intent is ADD_DEBT', res.intent === 'ADD_DEBT', res.intent);
P('test 1 debtor name is Falonchi', res.debtorName === 'Falonchi', res.debtorName);
P('test 1 amount is 100000', res.amount === 100000, res.amount);
P('test 1 due date is calculated for next Monday (2026-09-14)', res.dueDate === '2026-09-14', res.dueDate);

// Test 2: "Ali 500.000 juma"
res = parseHeuristic('Ali 500.000 juma', fixedNow);
P('test 2 debtor name is Ali', res.debtorName === 'Ali', res.debtorName);
P('test 2 amount is 500000', res.amount === 500000, res.amount);
P('test 2 due date is next Friday (2026-09-11)', res.dueDate === '2026-09-11', res.dueDate);

// Test 3: "Vali 1.5 mln ertaga nos sotib oldi"
res = parseHeuristic('Vali 1.5 mln ertaga nos sotib oldi', fixedNow);
P('test 3 debtor name is Vali', res.debtorName === 'Vali', res.debtorName);
P('test 3 amount is 1500000', res.amount === 1500000, res.amount);
P('test 3 due date is tomorrow (2026-09-09)', res.dueDate === '2026-09-09', res.dueDate);
P('test 3 note contains "nos sotib oldi"', res.note === 'nos sotib oldi', res.note);

// Test 4: "Sardor 50k haftaga"
res = parseHeuristic('Sardor 50k haftaga', fixedNow);
P('test 4 debtor name is Sardor', res.debtorName === 'Sardor', res.debtorName);
P('test 4 amount is 50000', res.amount === 50000, res.amount);
P('test 4 due date is 1 week later (2026-09-15)', res.dueDate === '2026-09-15', res.dueDate);

// Test 5: "Qarz olindi: Diyor 200ming som payshanba"
res = parseHeuristic('Qarz olindi Diyor 200ming som payshanba', fixedNow);
P('test 5 direction is taken', res.direction === 'taken', res.direction);
P('test 5 debtor name is Diyor', res.debtorName === 'Diyor', res.debtorName);
P('test 5 amount is 200000', res.amount === 200000, res.amount);

console.log('--- Weekday Date Calculations ---');
const dateInfo = calculateDueDate('dushanba', fixedNow);
P('dushanba from Tue Sep 8 is Mon Sep 14', dateInfo.date === '2026-09-14', dateInfo.date);

const ertagaInfo = calculateDueDate('ertaga', fixedNow);
P('ertaga from Tue Sep 8 is Wed Sep 9', ertagaInfo.date === '2026-09-09', ertagaInfo.date);

console.log('--- AI Handler & Menu Integration ---');
import { t } from '../src/lib/i18n.js';
import { handleAiGuide } from '../src/handlers/aiHandler.js';

P('locale key menu_ai in uz exists', t('menu_ai', 'uz') === '🤖 AI Yordamchi', t('menu_ai', 'uz'));
P('locale key menu_ai in ru exists', t('menu_ai', 'ru') === '🤖 AI Помощник', t('menu_ai', 'ru'));
P('locale key ai_guide_text in uz exists', t('ai_guide_text', 'uz').includes('AI Yordamchi'));

let replyCalledWith = null;
const mockCtx = {
  from: { id: 12345 },
  reply: async (text, opts) => {
    replyCalledWith = { text, opts };
  },
};

await handleAiGuide(mockCtx);
P('handleAiGuide sends guide text', replyCalledWith && replyCalledWith.text.includes('AI Yordamchi'));
P('handleAiGuide includes inline demo button', replyCalledWith && replyCalledWith.opts?.reply_markup);

