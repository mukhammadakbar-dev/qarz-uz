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
  ask_mode: 'Tanlang:',
  btn_new_debtor: '🆕 Yangi qarzdor',
  btn_select_existing: '📋 Mavjudlardan tanlash',
  ask_select_debtor: 'Qarzdorni tanlang:',
  debtors_not_found_new: 'Mavjud qarzdorlar topilmadi. Yangi qarzdor qo\'shamiz.',
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
  debtors_truncated: 'Faqat dastlabki {shown} ta ko\'rsatildi ({total} tadan). Qolganini veb-saytda ko\'ring.',
  debtor_line: '{i}. <b>{name}</b> — {outstanding} so\'m ({count} ta yozuv)',

  // --- Dashboard ---
  dashboard:
    '📊 <b>Hisobot</b>\n\n💰 Umumiy qarz: <b>{outstanding}</b> so\'m\n⏰ Muddati o\'tgan: <b>{overdueCount}</b> ta ({overdueTotal} so\'m)\n📈 Oylik aylanma: <b>{turnover}</b> so\'m\n✉️ SMS qoldiq: <b>{sms}</b>',

  // --- Daily sales ---
  ask_daily_cash:
    'Bugungi naqd/karta savdo summasini kiriting (so\'mda):',
  daily_saved:
    '✅ Kunlik savdo saqlandi!\n\n💵 Naqd/karta: {cash} so\'m\n🧾 Qarzga berilgan: {debt} so\'m\n📊 Jami aylanma: <b>{total}</b> so\'m',

  // --- Register (personal & shop) ---
  reg_ask_purpose: 'Qaysi maqsadda foydalanmoqchisiz?',
  reg_role_shop: '🏪 Do\'kon egasiman',
  reg_role_personal: '👤 Shaxsiy daftarcha (Oddiy foydalanuvchi)',
  reg_desc_shop: 'Do\'koningizdagi savdo va qarzlarni yuritish uchun.',
  reg_desc_personal: 'O\'zaro va shaxsiy qarzlaringizni yuritish uchun.',
  reg_ask_name: 'Ism va familiyangizni kiriting:',
  reg_ask_shopname: 'Do\'koningiz nomini kiriting (masalan: Baraka Savdo):',
  reg_ask_password: 'Parol o\'ylab toping (kamida 6 belgi):',
  reg_need_contact:
    'Ro\'yxatdan o\'tish uchun avval telefon raqamingizni ulashing 👇',
  reg_done: '✅ Ro\'yxatdan o\'tdingiz! Endi qarzlaringizni yuritishingiz mumkin.',
  reg_success_msg: '🎉 <b>Ro\'yxatdan muvaffaqiyatli o\'tdingiz!</b>\n\n👤 <b>Ism:</b> {name}\n📱 <b>Telefon:</b> <code>{phone}</code>\n🏷️ <b>Maqsad:</b> {roleLabel}\n\n🌐 <i>Veb-saytga (qarz-uz) kirish uchun "Telegram orqali kirish" tugmasini bosing.</i>',

  lang_choose: 'Tilni tanlang:',
  lang_uz: '🇺🇿 O\'zbekcha',
  lang_ru: '🇷🇺 Русский',
  lang_set: '✅ Til o\'zgartirildi / Язык изменён.',

  // --- OTP & Verify ---
  otp_sent:
    '📩 Tasdiqlash kodi <b>{phone}</b> raqamiga SMS orqali yuborildi.\n\nKodni kiriting (6 xona):',
  otp_ask_again: 'Kod 6 xonali raqam bo\'lishi kerak. Qayta kiriting:',
  otp_bad: '❌ {msg}\n\nQayta urinib ko\'ring yoki /start bilan boshidan boshlang.',
  otp_cancelled: 'Ulash bekor qilindi. /start bilan qayta boshlashingiz mumkin.',
  otp_no_account:
    '❌ Bu raqam tizimda topilmadi.\n\nDo\'kon egasi bo\'lsangiz, avval veb-saytda ro\'yxatdan o\'ting. Yoki /register orqali bepul akkaunt oching.',

  verify_ask_contact:
    '🔐 <b>Ro\'yxatdan o\'tishni tasdiqlash</b>\n\nTelefon raqamingiz haqiqatan sizniki ekanini tasdiqlash uchun quyidagi tugma orqali raqamingizni ulashing.',
  verify_ok_msg:
    '✅ <b>Tasdiqlandi!</b>\n\nEndi brauzerga qayting — ro\'yxatdan o\'tish avtomatik davom etadi.',
  verify_err_msg: '⚠️ Tasdiqlashda xatolik: {msg}',
  pay_link_msg: '💳 <b>Bir martalik to\'lov havolasi:</b>\n\n{url}',
  receipt_share_msg: '📲 <b>Mijozga yuborish uchun havola tayyor</b>\n\nUshbu havolani mijozga o\'zingiz yuboring:\n{url}',

  // --- Duplicate debtor picker ---
  dup_found:
    '🔎 Shunga o\'xshash mijoz topildi. Kimga qarz yozamiz?',
  dup_new_btn: '➕ Yangi mijoz',
  dup_option: '{name}{phone} — {outstanding}',
};
