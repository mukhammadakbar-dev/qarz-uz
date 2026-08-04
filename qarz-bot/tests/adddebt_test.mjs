// Drives addDebtConversation with a scripted fake conversation/context.
//
// Regression guard for the crash that made the bot's core flow unusable: the
// amount/due/note steps assigned to `msg`, which was only ever declared with
// `let` *inside* the earlier `if (!debtorId)` blocks. ES modules are strict
// mode, so every run threw `ReferenceError: msg is not defined` right after the
// phone step — no debt could be recorded from Telegram at all.
import { sessions } from '../src/lib/sessions.js';

const TG = 987654;
sessions.set(TG, { accessToken: 'A', refreshToken: 'R', role: 'shop_owner', lang: 'uz' });

// --- stub the backend ---
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  const method = opts.method || 'GET';
  calls.push(`${method} ${path}`);
  const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });

  if (path.startsWith('/api/debtors?') || path === '/api/debtors') {
    if (method === 'POST') return json({ id: 'debtor-9', full_name: 'Yangi Mijoz' });
    return json([]); // no existing matches -> "create new" path
  }
  if (path === '/api/debts' && method === 'POST') return json({ id: 'debt-9' });
  if (path.includes('/receipt')) return { ok: false, status: 500, text: async () => '' };
  return json({});
};

const { addDebtConversation } = await import('../src/scenes/addDebt.js');

// --- scripted conversation ---
const replies = [];
const script = [
  { type: 'cq', data: 'mode:new' },      // 0) new debtor
  { type: 'text', text: 'Akmal Yusupov' }, // 1) name
  { type: 'text', text: '901234567' },     // 2) phone
  { type: 'text', text: '50 000' },        // 4) amount  <-- used to crash here
  { type: 'text', text: '-' },             // 5) due date
  { type: 'text', text: 'un uchun' },      // 6) note
];
let step = 0;

const ctx = {
  from: { id: TG },
  reply: async (text) => { replies.push(text); },
  replyWithPhoto: async (_f, o) => { replies.push(o?.caption || '<photo>'); },
};

const conversation = {
  waitFor: async (filter) => {
    const item = script[step++];
    if (!item) throw new Error(`script exhausted (waitFor ${filter})`);
    if (item.type === 'cq') {
      return {
        callbackQuery: { data: item.data },
        answerCallbackQuery: async () => {},
      };
    }
    return { message: { text: item.text } };
  },
  external: (fn) => fn(),
};

let failures = 0;
const P = (n, c, extra = '') => {
  if (!c) failures++;
  console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
};

let crashed = null;
try {
  await addDebtConversation(conversation, ctx);
} catch (err) {
  crashed = err;
}

P('conversation completes without throwing', crashed === null,
  crashed ? `${crashed.constructor.name}: ${crashed.message}` : '');
P('debtor was created', calls.includes('POST /api/debtors'), calls.join(' | '));
P('debt was created', calls.includes('POST /api/debts'), calls.join(' | '));
P('whole script consumed (reached the note step)', step === script.length, `step=${step}`);
P('user got a confirmation', replies.some((r) => /50 000/.test(r)), replies.join(' // '));

sessions.clear(TG);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
