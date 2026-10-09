import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regressiya qo'riqchisi (T6.1): yangi `/api/*` route autentifikatsiyasiz qo'shilib qolmasin.
 * Har bir route ikkinchi argumenti `guard…` yoki `{ preHandler… }` bo'lishi shart.
 * Ochiq istisno faqat bitta: initData bilan kirish (unda IP bo'yicha qattiq chegara bor).
 */
const FILES = ['./routes.ts', '../http/auth.ts', './admin.ts'];
const PUBLIC = new Set(['/api/auth/telegram']);
const ROUTE = /app\.(get|post|patch|put|delete)\(\s*[`'"]([^`'"]+)[`'"]\s*,\s*([^\n]*)/g;

describe('API route himoyasi', () => {
  const routes = FILES.flatMap((file) => {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    return [...source.matchAll(ROUTE)].map((m) => ({
      file,
      path: m[2]!,
      options: m[3]!.trim(),
    }));
  });
  // Shablonli yo'l (`ledgerWrite`) ham ushlanadi: `/api/customers/:id/${...}`
  const api = routes.filter((r) => r.path.startsWith('/api'));

  it("route'lar topildi (regex buzilmagan)", () => {
    expect(api.length).toBeGreaterThanOrEqual(30);
  });

  it.each(api.filter((r) => !PUBLIC.has(r.path)))('$path himoyalangan ($file)', ({ options }) => {
    expect(options).toMatch(/^(guard\b|\{\s*preHandler\b)/);
  });

  it("ochiq route'lar ro'yxati o'zgarmagan", () => {
    const open = api.filter((r) => /^(guard\b|\{\s*preHandler\b)/.test(r.options) === false);
    expect(open.map((r) => r.path)).toEqual([...PUBLIC]);
  });
});
