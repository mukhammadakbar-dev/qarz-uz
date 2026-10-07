export const uzLatn = {
  'welcome.new':
    'Assalomu alaykum! 👋\n\nTemir Daftar — do‘koningizdagi nasiyalarni Telegramda oddiygina yozib boradigan daftar.\n\nTilni tanlang / Тилни танланг:',
  'lang.button.latn': 'O‘zbekcha (Lotin)',
  'lang.button.cyrl': 'Ўзбекча (Кирилл)',
  'lang.chosen': 'Til tanlandi: O‘zbekcha (Lotin).',
  'lang.pick': 'Tilni tanlang:',

  'onboarding.askName': 'Do‘koningiz (biznesingiz) nomini yozing.\nMasalan: Baraka do‘koni',
  'onboarding.nameInvalid':
    'Nom 1 dan 100 gacha belgidan iborat bo‘lishi va buyruq (/) bilan boshlanmasligi kerak. Qayta yozing.',
  'onboarding.limit': 'Siz ko‘pi bilan {max} ta biznes ochishingiz mumkin.',
  'onboarding.created':
    '✅ «{name}» yaratildi.\n\n{days} kunlik bepul sinov boshlandi (yakuni: {date}).\n\nNasiyani oddiy yozing, masalan:\nMurod 50 ming\nMurod 20 ming berdi',
  'onboarding.createdNoTrial':
    '✅ «{name}» yaratildi.\n\nBu hisob uchun bepul sinov avval ishlatilgan. Davom etish uchun obuna kerak.\n{support}',

  'start.back': 'Xush kelibsiz! «{name}» biznesi.\nObuna: {status}',
  'start.choose': 'Qaysi biznes bilan ishlaymiz?',
  'start.switched': '«{name}» tanlandi.',

  'invite.created':
    'Xodim taklifi (48 soat amal qiladi, bir marta ishlatiladi):\n{link}\n\nHavolani faqat o‘sha xodimga yuboring.',
  'invite.joined': '✅ Siz «{name}» biznesiga xodim sifatida qo‘shildingiz.',
  'invite.invalid':
    'Taklif havolasi yaroqsiz yoki muddati o‘tgan. Biznes egasidan yangisini so‘rang.',
  'invite.ownerNotice': '👤 {user} «{business}» biznesiga xodim sifatida qo‘shildi.',

  'menu.title': '«{name}» — {role}\nObuna: {status}',
  'menu.openApp': '📱 Ilovani ochish',
  'menu.noApp': 'Ilova (Mini App) hozircha ulanmagan.',
  'menu.invite': 'Xodim qo‘shish: /invite',

  'status.trial': 'sinov muddati, {date} gacha ({days} kun qoldi)',
  'status.active': 'faol, {date} gacha',
  'status.expired': 'muddati tugagan — faqat ko‘rish mumkin',
  'status.pay': 'To‘lash uchun: {phone}',

  'role.OWNER': 'Egasi',
  'role.STAFF': 'Xodim',

  help: 'Temir Daftar — nasiya hisobi.\n\nOddiy yozing:\n• Murod 450 ming — nasiya yozish\n• Murod 200 ming berdi — to‘lov\n• Murod qancha qarz? — qoldiq\n\nBuyruqlar:\n/menu — asosiy menyu\n/invite — xodim taklif qilish (egasi)\n/lang — tilni almashtirish\n/help — yordam',

  'error.generic': 'Kechirasiz, xatolik yuz berdi. Iltimos, qayta urinib ko‘ring.',
  'error.noBusiness': 'Avval biznes yarating: /start',
  'error.forbidden': 'Bu amal uchun ruxsatingiz yo‘q.',
  'fallback.unknown': 'Tushunmadim. Yordam uchun /help',
} as const;

export type MessageKey = keyof typeof uzLatn;
