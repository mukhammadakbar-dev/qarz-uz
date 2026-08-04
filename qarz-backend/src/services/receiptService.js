import { Resvg } from '@resvg/resvg-js';

/**
 * Format currency number to Uzbek format (e.g. 1 000 000 UZS)
 */
function formatMoney(amount) {
  const num = Math.abs(Number(amount) || 0);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' UZS';
}

/**
 * Generates a high-resolution, modern PNG receipt image as a Buffer.
 *
 * @param {Object} opts
 * @param {string} opts.shopName
 * @param {string} opts.debtorName
 * @param {'given'|'taken'|'payment'} opts.type
 * @param {number} opts.amount
 * @param {number} [opts.remainingBalance=0]
 * @param {string} [opts.date]
 * @param {string} [opts.receiptId]
 * @param {string} [opts.payUrl]
 * @returns {Buffer} PNG image buffer
 */
export function generateReceiptPng({
  shopName = "TemirDaftar.uz Do'koni",
  debtorName = 'Mijoz',
  type = 'given',
  amount = 0,
  remainingBalance = 0,
  date = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }),
  receiptId = `QZ-${Math.floor(100000 + Math.random() * 900000)}`,
  payUrl = ''
}) {
  const isPayment = type === 'payment';
  const isTaken = type === 'taken';

  const typeTitle = isPayment
    ? "TO'LOV QABUL QILINDI"
    : isTaken
    ? "QARZ OLINDI"
    : "YANGI QARZ YOZILDI";

  const statusBg = isPayment ? '#10B981' : isTaken ? '#3B82F6' : '#EF4444';
  const statusIcon = isPayment ? '✓' : isTaken ? '↓' : '↑';

  const svg = `
  <svg width="600" height="780" viewBox="0 0 600 780" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0F172A"/>
        <stop offset="100%" stop-color="#1E293B"/>
      </linearGradient>
      <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#1E293B"/>
        <stop offset="100%" stop-color="#0F172A"/>
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.4"/>
      </filter>
    </defs>

    <!-- Background -->
    <rect width="600" height="780" rx="0" fill="url(#bgGrad)"/>

    <!-- Main Receipt Card -->
    <g filter="url(#shadow)">
      <rect x="40" y="40" width="520" height="700" rx="24" fill="url(#cardGrad)" stroke="#334155" stroke-width="2"/>
    </g>

    <!-- Header Section -->
    <text x="300" y="90" font-family="sans-serif" font-size="22" font-weight="bold" fill="#38BDF8" text-anchor="middle">
      ${escapeXml(shopName)}
    </text>
    <text x="300" y="118" font-family="sans-serif" font-size="13" fill="#94A3B8" text-anchor="middle">
      ELEKTRON KVITANSIYA
    </text>

    <!-- Status Badge -->
    <rect x="180" y="145" width="240" height="38" rx="19" fill="${statusBg}"/>
    <text x="300" y="170" font-family="sans-serif" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">
      ${statusIcon} ${typeTitle}
    </text>

    <!-- Amount Section -->
    <text x="300" y="235" font-family="sans-serif" font-size="14" fill="#94A3B8" text-anchor="middle">
      SUMMA
    </text>
    <text x="300" y="280" font-family="sans-serif" font-size="36" font-weight="bold" fill="#F8FAFC" text-anchor="middle">
      ${escapeXml(formatMoney(amount))}
    </text>

    <!-- Separator Line -->
    <line x1="80" y1="315" x2="520" y2="315" stroke="#334155" stroke-width="2" stroke-dasharray="6,6"/>

    <!-- Details Table -->
    <!-- Row 1: Debtor -->
    <text x="80" y="360" font-family="sans-serif" font-size="15" fill="#94A3B8">Mijoz / Qabul qiluvchi:</text>
    <text x="520" y="360" font-family="sans-serif" font-size="16" font-weight="bold" fill="#F8FAFC" text-anchor="end">
      ${escapeXml(debtorName)}
    </text>

    <!-- Row 2: Date -->
    <text x="80" y="410" font-family="sans-serif" font-size="15" fill="#94A3B8">Sana va vaqt:</text>
    <text x="520" y="410" font-family="sans-serif" font-size="15" fill="#CBD5E1" text-anchor="end">
      ${escapeXml(date)}
    </text>

    <!-- Row 3: Receipt ID -->
    <text x="80" y="460" font-family="sans-serif" font-size="15" fill="#94A3B8">Kvitansiya ID:</text>
    <text x="520" y="460" font-family="sans-serif" font-size="15" font-weight="bold" fill="#38BDF8" text-anchor="end">
      ${escapeXml(receiptId)}
    </text>

    <!-- Row 4: Remaining Balance -->
    <rect x="80" y="495" width="440" height="54" rx="14" fill="#0F172A" stroke="#334155" stroke-width="1"/>
    <text x="100" y="528" font-family="sans-serif" font-size="15" fill="#94A3B8">Qolgan jami balans:</text>
    <text x="500" y="528" font-family="sans-serif" font-size="17" font-weight="bold" fill="${remainingBalance > 0 ? '#EF4444' : '#10B981'}" text-anchor="end">
      ${escapeXml(formatMoney(remainingBalance))}
    </text>

    <!-- Footer Branding -->
    <rect x="80" y="580" width="440" height="90" rx="16" fill="#1E293B"/>
    <text x="300" y="618" font-family="sans-serif" font-size="16" font-weight="bold" fill="#38BDF8" text-anchor="middle">
      TemirDaftar.uz — Qarzlarni xavfsiz boshqaruv tizimi
    </text>
    <text x="300" y="645" font-family="sans-serif" font-size="13" fill="#64748B" text-anchor="middle">
      ${payUrl ? 'To\'lov qilish uchun botdagi to\'lov linkidan foydalaning' : 'Ushbu kvitansiya avtomatik generatsiya qilindi'}
    </text>

    <!-- Bottom Line Bar -->
    <rect x="40" y="730" width="520" height="10" rx="5" fill="#38BDF8"/>
  </svg>
  `;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 600 }
  });

  const pngData = resvg.render();
  return pngData.asPng();
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
