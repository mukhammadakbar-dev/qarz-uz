// Interpolated values must not be able to break Telegram's HTML parser.
//
// THE BUG: almost every message this bot sends uses parse_mode: 'HTML', and the
// templates carry real tags (<b>, <code>, <i>). The values substituted into them
// are user input — a shop name, a person's name — and went in raw. A shop called
// "Diyor <Market>" or "A&B" produced markup Telegram refuses to parse, so the
// send failed with 400 and the user received nothing at all: no registration
// confirmation, no debtors list, no explanation.
//
// Debtor names are validated letters-only by the backend, which hid the problem;
// shop names and user names are plain strings and were never covered.
import { t, tPlain } from '../src/lib/i18n.js';

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

// ---------------------------------------------------------------------------
console.log('--- values are escaped, templates are not ---');

let out = t('debtor_line', 'uz', { i: 1, name: 'Diyor <Market>', outstanding: '50 000', count: 2 });
P('a < in a value is escaped', out.includes('&lt;Market&gt;'), out);
P('the template keeps its own tags', out.includes('<b>') && out.includes('</b>'), out);
P('no raw angle bracket survives around the value', !out.includes('<Market>'), out);

out = t('debtor_line', 'uz', { i: 1, name: 'Ali & Vali', outstanding: '1', count: 1 });
P('an ampersand is escaped', out.includes('Ali &amp; Vali'), out);

// The shape that actually breaks a parser: an unclosed tag.
out = t('error_generic', 'uz', { msg: '<b>oops' });
P('an unclosed tag cannot leak through', !/<b>oops/.test(out) && out.includes('&lt;b&gt;oops'), out);

// A closing tag the template never opened would end the message early.
out = t('reg_success_msg', 'uz', { name: '</b><i>x', phone: '+998901111111', roleLabel: 'shop' });
P('a stray closing tag is neutralised', !out.includes('</b><i>x'), out);

// ---------------------------------------------------------------------------
console.log('--- escaping does not corrupt ordinary content ---');

out = t('pay_link_msg', 'uz', { url: 'https://x.uz/pay/abc?a=1&b=2' });
// &amp; is what a correct HTML document contains; Telegram renders it back as
// "&", so the link the customer sees and taps is unchanged.
P('a URL query string is escaped, not mangled', out.includes('a=1&amp;b=2'), out);
P('the rest of the URL is untouched', out.includes('https://x.uz/pay/abc'), out);

out = t('dashboard', 'uz', {
  outstanding: '1 000', overdueCount: 0, overdueTotal: '0', turnover: '5 000', sms: 30,
});
P('plain values pass through unchanged', out.includes('1 000') && out.includes('5 000'));

out = t('sub_plan_line', 'uz', { name: 'Pro', price: "99 000 so'm/oy", debtors: 500, sms: 100 });
P('an apostrophe is left alone', out.includes("so'm/oy"), out);

// ---------------------------------------------------------------------------
console.log('--- button captions stay plain ---');

// An inline keyboard caption is NOT parsed as HTML, so escaping there would
// show the entity itself to the user.
out = tPlain('dup_option', 'uz', { name: 'Ali & Vali', phone: '', outstanding: '1 000' });
P('tPlain leaves & as-is for button text', out.includes('Ali & Vali'), out);
P('and does not introduce entities', !out.includes('&amp;'), out);

// Same key through the escaping path, to show the two really differ.
const escaped = t('dup_option', 'uz', { name: 'Ali & Vali', phone: '', outstanding: '1 000' });
P('t and tPlain differ exactly where it matters', escaped !== out && escaped.includes('&amp;'));

// ---------------------------------------------------------------------------
console.log('--- unchanged behaviour ---');

P('a missing key still falls back to the key', t('no_such_key_at_all', 'uz') === 'no_such_key_at_all');
P('ru falls back to uz for a missing translation', typeof t('debtor_line', 'ru') === 'string');
P('a template with no vars is returned as-is', t('menu_debtors', 'uz') === t('menu_debtors', 'uz'));
