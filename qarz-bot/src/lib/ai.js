import { config } from './config.js';

const WEEKDAYS = {
  yakshanba: 0,
  dushanba: 1,
  seshanba: 2,
  sechanba: 2,
  chorshanba: 3,
  payshanba: 4,
  juma: 5,
  shanba: 6,
  // Russian weekdays
  воскресенье: 0,
  понедельник: 1,
  вторник: 2,
  среда: 3,
  четверг: 4,
  пятница: 5,
  суббота: 6,
};

/** Format date as YYYY-MM-DD */
export const formatDateIso = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Format date in human readable Uzbek format e.g. "Dushanba (14.09.2026)" */
export const formatDateUzbek = (isoStr, weekdayName = '') => {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  const formattedDate = `${day}.${month}.${year}`;
  if (weekdayName) {
    const capitalizedDay = weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1);
    return `${capitalizedDay} (${formattedDate})`;
  }
  return formattedDate;
};

/** Calculate target date based on weekday name or relative term */
export const calculateDueDate = (term, baseDate = new Date()) => {
  const clean = term.toLowerCase().trim();
  const now = new Date(baseDate);
  now.setHours(0, 0, 0, 0);

  if (clean === 'ertaga' || clean === 'завтра') {
    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    return { date: formatDateIso(target), label: `Ertaga (${formatDateUzbek(formatDateIso(target))})` };
  }

  if (clean === 'indinga' || clean === 'inshoat' || clean === 'послезавтра') {
    const target = new Date(now);
    target.setDate(target.getDate() + 2);
    return { date: formatDateIso(target), label: `Indinga (${formatDateUzbek(formatDateIso(target))})` };
  }

  if (clean === 'haftaga' || clean === '1 haftadan keyin' || clean === 'bir haftaga') {
    const target = new Date(now);
    target.setDate(target.getDate() + 7);
    return { date: formatDateIso(target), label: `1 haftadan keyin (${formatDateUzbek(formatDateIso(target))})` };
  }

  if (clean === 'oyga' || clean === '1 oydan keyin' || clean === 'bir oyga') {
    const target = new Date(now);
    target.setMonth(target.getMonth() + 1);
    return { date: formatDateIso(target), label: `1 oydan keyin (${formatDateUzbek(formatDateIso(target))})` };
  }

  for (const [dayName, dayIndex] of Object.entries(WEEKDAYS)) {
    if (clean.includes(dayName)) {
      const currentDay = now.getDay();
      let diff = dayIndex - currentDay;
      if (diff <= 0) diff += 7; // Next occurrence
      const target = new Date(now);
      target.setDate(target.getDate() + diff);
      const dayCap = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      return {
        date: formatDateIso(target),
        label: `${dayCap} (${formatDateUzbek(formatDateIso(target))})`,
        weekday: dayCap,
      };
    }
  }

  // Check if standard date string like YYYY-MM-DD or DD.MM.YYYY
  const dateMatch = clean.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1;
    const year = dateMatch[3] ? (dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3], 10) : parseInt(dateMatch[3], 10)) : now.getFullYear();
    const target = new Date(year, month, day);
    if (!isNaN(target.getTime())) {
      return { date: formatDateIso(target), label: formatDateUzbek(formatDateIso(target)) };
    }
  }

  return { date: null, label: null };
};

/** Heuristic Uzbek/Russian natural language parser fallback */
export const parseHeuristic = (text, now = new Date()) => {
  if (!text || typeof text !== 'string') {
    return { intent: 'GENERAL', debtorName: null, amount: null, dueDate: null, dueLabel: null, direction: 'given', note: null };
  }

  const raw = text.trim();
  const lower = raw.toLowerCase();

  // Intent classification
  let intent = 'ADD_DEBT';
  if (lower.includes('to\'ladi') || lower.includes('toladi') || lower.includes('qaytardi') || lower.includes('оплатил') || lower.includes('вернул')) {
    intent = 'PAY_DEBT';
  } else if (lower.includes('qancha') || lower.includes('skolko') || lower.includes('qarzim') || lower.includes('qarzi')) {
    intent = 'SEARCH_DEBTOR';
  }

  // 1) Amount parsing
  let amount = null;
  // Match patterns like: 100ming, 100 ming, 1.5mln, 1.5 mln, 50k, 100.000, 100 000, 100000, 500$
  const amountRegex = /(\d+(?:[.,]\d+)?)\s*(ming|mln|m|k|dollar|\$|som|so'm|сўм|сум)?/gi;
  let match;
  let amountMatchStr = '';

  const numbersFound = [];
  while ((match = amountRegex.exec(raw)) !== null) {
    const valStr = match[1].replace(',', '.');
    const numVal = parseFloat(valStr);
    const unit = (match[2] || '').toLowerCase();

    if (isNaN(numVal)) continue;

    let total = numVal;
    if (unit === 'ming' || unit === 'k') {
      total = numVal * 1000;
    } else if (unit === 'mln' || unit === 'm') {
      total = numVal * 1000000;
    }

    // Handle dot separator like 100.000
    if (!unit && match[1].includes('.') && match[1].split('.')[1].length === 3) {
      total = parseFloat(match[1].replace(/\./g, ''));
    }

    numbersFound.push({ raw: match[0], val: total, index: match.index });
  }

  if (numbersFound.length > 0) {
    const primary = numbersFound.reduce((prev, curr) => (curr.val > prev.val ? curr : prev), numbersFound[0]);
    amount = primary.val;
    amountMatchStr = primary.raw;
  }

  // 2) Due Date parsing
  let dueDate = null;
  let dueLabel = null;
  let dateFoundStr = '';

  const dateKeywords = [
    'dushanba', 'seshanba', 'sechanba', 'chorshanba', 'payshanba', 'juma', 'shanba', 'yakshanba',
    'ertaga', 'indinga', 'inshoat', 'haftaga', 'oyga', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье', 'завтра'
  ];

  for (const kw of dateKeywords) {
    if (lower.includes(kw)) {
      const dateInfo = calculateDueDate(kw, now);
      if (dateInfo.date) {
        dueDate = dateInfo.date;
        dueLabel = dateInfo.label;
        dateFoundStr = kw;
        break;
      }
    }
  }

  // 3) Direction parsing (qarz berildi vs qarz olindi)
  let direction = 'given';
  if (lower.includes('oldim') || lower.includes('qarz olindi') || lower.includes('взял')) {
    direction = 'taken';
  }

  // 4) Name extraction
  let cleaned = raw;
  if (amountMatchStr) cleaned = cleaned.replace(amountMatchStr, ' ');
  if (dateFoundStr) cleaned = cleaned.replace(new RegExp(dateFoundStr, 'gi'), ' ');

  const stopWords = [
    'deb yozsa', 'deb yoz', 'deb', 'yozsa', 'yoz', 'qarz', 'berdim', 'berdi', 'olindi', 'oldim',
    'so\'m', 'som', 'сўм', 'сум', 'dollar', '$', 'ming', 'mln', 'k', 'ga', 'ni', 'dan'
  ];

  for (const sw of stopWords) {
    cleaned = cleaned.replace(new RegExp(`\\b${sw}\\b`, 'gi'), ' ');
  }

  cleaned = cleaned.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  const words = cleaned.split(' ').filter(w => w.length > 1);
  let debtorName = null;
  let note = null;

  if (words.length > 0) {
    debtorName = words[0];
    debtorName = debtorName.charAt(0).toUpperCase() + debtorName.slice(1).toLowerCase();

    if (words.length > 1) {
      note = words.slice(1).join(' ');
    }
  }

  return {
    intent,
    debtorName,
    amount,
    dueDate,
    dueLabel,
    direction,
    note
  };
};

/** Parse natural language message using Gemini REST API or LLM with Heuristic Fallback */
export const parseNaturalLanguage = async (text, now = new Date()) => {
  const fallbackResult = parseHeuristic(text, now);

  if (!config.geminiApiKey && !config.openaiApiKey) {
    return fallbackResult;
  }

  try {
    const todayIso = formatDateIso(now);
    const systemPrompt = `You are a natural language parser for TemirDaftar.uz debt tracking app.
Extract structured details from user text. Today is ${todayIso}.

Output JSON matching this exact structure:
{
  "intent": "ADD_DEBT" | "PAY_DEBT" | "SEARCH_DEBTOR" | "GENERAL",
  "debtorName": "Name of person (string or null)",
  "amount": numeric value in UZS (number or null),
  "dueDate": "YYYY-MM-DD" (ISO date calculated relative to today ${todayIso} or null),
  "dueLabel": "Human readable date label in Uzbek or null",
  "direction": "given" | "taken",
  "note": "Any additional detail/item mentioned or null"
}`;

    if (config.geminiApiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${systemPrompt}\n\nUser input: "${text}"` }] }
          ],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (responseText) {
          const parsed = JSON.parse(responseText);
          return {
            intent: parsed.intent || fallbackResult.intent,
            debtorName: parsed.debtorName || fallbackResult.debtorName,
            amount: parsed.amount ? Number(parsed.amount) : fallbackResult.amount,
            dueDate: parsed.dueDate || fallbackResult.dueDate,
            dueLabel: parsed.dueLabel || fallbackResult.dueLabel,
            direction: parsed.direction || fallbackResult.direction,
            note: parsed.note || fallbackResult.note,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[ai] Gemini/LLM API error, using heuristic fallback:', err.message);
  }

  return fallbackResult;
};
