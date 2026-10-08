import { describe, expect, it } from 'vitest';
import { subscriptionRequestText, subscriptionRequestUrl, supportChatUrl } from './support.js';

describe('admin chat havolasi', () => {
  it('telefon raqami bo‘yicha, faqat raqamlar qoladi', () => {
    expect(supportChatUrl('+998 90 790-01-10')).toBe('https://t.me/+998907900110');
  });

  it('obuna so‘rovi: xabar biznes kodi bilan oldindan yoziladi', () => {
    const url = subscriptionRequestUrl('+998907900110', 'uz-Latn', 'TD-AB2CD');
    const [base, query] = url.split('?text=') as [string, string];
    expect(base).toBe('https://t.me/+998907900110');
    expect(decodeURIComponent(query)).toBe(
      'Assalomu alaykum! Obuna muddatini uzaytirmoqchiman. ID: `TD-AB2CD`',
    );
  });

  it('Kirill foydalanuvchiga Kirill matn', () => {
    expect(subscriptionRequestText('uz-Cyrl', 'TD-AB2CD')).toBe(
      'Ассалому алайкум! Обуна муддатини узайтирмоқчиман. ID: `TD-AB2CD`',
    );
  });
});
