export default {
  // --- General ---
  welcome:
    'Assalomu alaykum! 👋\n\n<b>Qarzlarni boshqarish tizimi</b> botiga xush kelibsiz.\n\nDavom etish uchun telefon raqamingizni ulashing 👇',
  share_contact_btn: '📱 Telefon raqamni ulashish',
  linked_owner:
    '✅ Akkauntingiz bog\'landi!\nSiz <b>do\'kon egasi</b> sifatida kirdingiz.',
  linked_personal:
    '✅ Akkauntingiz bog\'landi!\nSiz <b>oddiy foydalanuvchi</b> sifatida kirdingiz.',
  not_found:
    '❌ Bu telefon raqami tizimda topilmadi.\n\nAgar do\'kon egasi bo\'lsangiz, avval veb-saytda ro\'yxatdan o\'ting. Yoki oddiy foydalanuvchi sifatida ro\'yxatdan o\'tish uchun /register buyrug\'ini yuboring.',
  session_expired: '⏳ Sessiya muddati tugadi. Iltimos, /start ni bosing.',
  error_generic: '⚠️ Xatolik yuz berdi: {msg}',
  cancelled: 'Bekor qilindi.',
  cancel_btn: '❌ Bekor qilish',

  // --- Main menu ---
  menu_title: 'Asosiy menyu. Amalni tanlang:',
  menu_add_debt: '➕ Qarz yozish',
  menu_debtors: '👥 Qarzdorlar',
  menu_dashboard: '📊 Hisobot',
  menu_daily_sales: '💰 Kunlik savdo',
  menu_lang: '🌐 Til',

  // --- Add debt flow ---
  ask_debtor_name: 'Qarzdorning ismini kiriting:',
  ask_debtor_phone:
    'Qarzdorning telefon raqamini kiriting (yoki o\'tkazib yuborish uchun "-"):',
  ask_direction: 'Bu qanday yozuv?',
  dir_given: '➕ Menga qarzdor',
  dir_taken: '➖ Men qarzdorman',
  ask_amount: 'Qarz summasini kiriting (so\'mda):',
  ask_amount_invalid: 'Iltimos, to\'g\'ri summa kiriting (masalan: 50000).',
  ask_due_date:
    'Qaytarish muddatini kiriting (YYYY-MM-DD), yoki "-" muddatsiz:',
  ask_due_invalid: 'Sana formati noto\'g\'ri. Masalan: 2026-08-15',
  ask_note: 'Izoh qo\'shing (yoki "-"):',
  debt_created:
    '✅ Qarz yozildi!\n\n👤 {name}\n💵 {amount} so\'m\n📅 Muddat: {due}',

  // --- Debtors list ---
  debtors_empty: 'Hozircha qarzdorlar yo\'q.',
  debtors_header: '👥 <b>Qarzdorlar ro\'yxati:</b>',
  debtor_line: '{i}. <b>{name}</b> — {outstanding} so\'m ({count} ta yozuv)',

  // --- Dashboard ---
  dashboard:
    '📊 <b>Hisobot</b>\n\n💰 Umumiy qarz: <b>{outstanding}</b> so\'m\n⏰ Muddati o\'tgan: <b>{overdueCount}</b> ta ({overdueTotal} so\'m)\n📈 Oylik aylanma: <b>{turnover}</b> so\'m\n✉️ SMS qoldiq: <b>{sms}</b>',

  // --- Daily sales ---
  ask_daily_cash:
    'Bugungi naqd/karta savdo summasini kiriting (so\'mda):',
  daily_saved:
    '✅ Kunlik savdo saqlandi!\n\n💵 Naqd/karta: {cash} so\'m\n🧾 Qarzga berilgan: {debt} so\'m\n📊 Jami aylanma: <b>{total}</b> so\'m',

  // --- Register (personal) ---
  reg_ask_name: 'Ismingizni kiriting:',
  reg_ask_password: 'Parol o\'ylab toping (kamida 6 belgi):',
  reg_need_contact:
    'Ro\'yxatdan o\'tish uchun avval telefon raqamingizni ulashing 👇',
  reg_done: '✅ Ro\'yxatdan o\'tdingiz! Endi qarzlaringizni yuritishingiz mumkin.',

  lang_choose: 'Tilni tanlang:',
  lang_uz: '🇺🇿 O\'zbekcha',
  lang_ru: '🇷🇺 Русский',
  lang_set: '✅ Til o\'zgartirildi.',

  // --- OTP linking ---
  otp_sent:
    '📩 Tasdiqlash kodi <b>{phone}</b> raqamiga SMS orqali yuborildi.\n\nKodni kiriting (6 xona):',
  otp_ask_again: 'Kod 6 xonali raqam bo\'lishi kerak. Qayta kiriting:',
  otp_bad: '❌ {msg}\n\nQayta urinib ko\'ring yoki /start bilan boshidan boshlang.',
  otp_cancelled: 'Ulash bekor qilindi. /start bilan qayta boshlashingiz mumkin.',
  otp_no_account:
    '❌ Bu raqam tizimda topilmadi.\n\nDo\'kon egasi bo\'lsangiz, avval veb-saytda ro\'yxatdan o\'ting. Yoki /register orqali bepul akkaunt oching.',

  // --- Duplicate debtor picker ---
  dup_found:
    '🔎 Shunga o\'xshash mijoz topildi. Kimga qarz yozamiz?',
  dup_new_btn: '➕ Yangi mijoz',
  dup_option: '{name}{phone} — {outstanding}',
};
