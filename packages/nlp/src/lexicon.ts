/**
 * Leksikon. Barcha so'zlar `normalizeText` dan keyingi Lotin shaklida va APOSTROFSIZ ("to'ladi" → "toladi"):
 * foydalanuvchilar apostrofni tez-tez tushirib qoldiradi, taqqoslash esa apostrofsiz bajariladi.
 */

export const bare = (token: string): string => token.replaceAll("'", '');

/** 3-shaxs, o'tgan zamon: mijoz to'ladi → TO'LOV. */
export const PAY_VERBS: ReadonlySet<string> = new Set([
  'berdi',
  'toladi',
  'qaytardi',
  'tashladi',
  'yopdi',
  'uzdi',
  'tolov',
  'otkazdi',
]);
/** 1-shaxs: "Murodga 50 ming berdim" (men berdim) → NASIYA. */
export const GIVE_FIRST_PERSON: ReadonlySet<string> = new Set(['berdim']);
export const DEBT_VERBS: ReadonlySet<string> = new Set([
  'yoz',
  'yozing',
  'yozib',
  'yozgan',
  'yozdim',
  'nasiya',
  'nasiyaga',
  'oldi',
]);

/** Moliyaviy operatsiya EMAS: inkor, kelasi zamon, majburiyat. */
export const NEGATION_OR_FUTURE: ReadonlySet<string> = new Set([
  'bermadi',
  'tolamadi',
  'qaytarmadi',
  'bermaydi',
  'tolamaydi',
  'qaytarmaydi',
  'bermagan',
  'tolamagan',
  'yozma',
  'yozmang',
  'beradi',
  'beraman',
  'beramiz',
  'tolaydi',
  'qaytaradi',
  'bermoqchi',
  'tolamoqchi',
  'qaytarmoqchi',
  'berishi',
  'tolashi',
  'qaytarishi',
  'kerak',
  'berar',
  'tolar',
  'ertaga',
  'keyin',
]);
export const DELETE_WORDS: ReadonlySet<string> = new Set([
  'ochir',
  'ochiring',
  'ochirish',
  'delete',
  'remove',
]);

export const FULL_WORDS: ReadonlySet<string> = new Set([
  'qarzini',
  'pulini',
  'hammasini',
  'hamma',
  'toliq',
  'butun',
  'butunlay',
]);
export const FRACTION_HALF: ReadonlySet<string> = new Set(['yarmini', 'yarmi']);
export const FRACTION_QUARTER: ReadonlySet<string> = new Set(['choragini', 'chorak']);

export const VIEW_BALANCE_WORDS: ReadonlySet<string> = new Set([
  'balansi',
  'balans',
  'qoldiq',
  'qoldigi',
]);
export const HISTORY_WORDS: ReadonlySet<string> = new Set([
  'tarixi',
  'tarix',
  'operatsiyalari',
  'operatsiya',
  'harakatlari',
]);

export const CANCEL_WORDS: ReadonlySet<string> = new Set([
  'bekor',
  'bekorqilish',
  'cancel',
  'otmena',
  'yoq',
  'yoqol',
]);

export const GREETINGS: ReadonlySet<string> = new Set([
  'salom',
  'assalomu',
  'alaykum',
  'assalom',
  'rahmat',
  'raxmat',
  'privet',
  'hello',
  'hi',
  'xayr',
  'qalaysiz',
  'yaxshi',
  'zormisiz',
  'ok',
  'okey',
  'ha',
  'yoq',
]);

/** Ism tarkibiga kirmaydigan so'zlar (yuqoridagi to'plamlarga qo'shimcha). */
export const FILLERS: ReadonlySet<string> = new Set([
  'som',
  'sum',
  'soum',
  'pul',
  'puli',
  'qarz',
  'qarzi',
  'qarzining',
  'qarzlarni',
  'qildi',
  'edim',
  'yana',
  'kecha',
  'bugun',
  'qoy',
  'qoyish',
  'qosh',
  'qoshish',
  'yarat',
  'yangi',
  'mijoz',
  'qancha',
  'bor',
  'qoldi',
  'iltimos',
  'va',
  'ham',
  'uchdan',
  'birini',
  'yarim',
  'tolovni',
  'degan',
  'ning',
  'uchun',
]);

export const ORDINALS: Readonly<Record<string, number>> = {
  birinchi: 1,
  birinchisi: 1,
  '1': 1,
  '1-si': 1,
  '1si': 1,
  '1-chi': 1,
  '1chi': 1,
  ikkinchi: 2,
  ikkinchisi: 2,
  '2': 2,
  '2-si': 2,
  '2si': 2,
  '2-chi': 2,
  '2chi': 2,
  uchinchi: 3,
  uchinchisi: 3,
  '3': 3,
  '3-si': 3,
  '3si': 3,
  '3-chi': 3,
  '3chi': 3,
  tortinchi: 4,
  tortinchisi: 4,
  '4': 4,
  '4-si': 4,
  '4si': 4,
  beshinchi: 5,
  beshinchisi: 5,
  '5': 5,
  '5-si': 5,
  '5si': 5,
};

export const NEW_CUSTOMER_WORDS: ReadonlySet<string> = new Set(['yangi', 'yangimijoz', 'new']);
