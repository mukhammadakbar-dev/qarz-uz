export default {
  // --- General ---
  welcome:
    'Assalomu alaykum! 👋\n\n<b>Temir Daftar</b> — aqlli qarz daftari botiga xush kelibsiz.\n\nBot orqali qarzlarni saqlashingiz, mijozlarga SMS yuborishingiz va hisobotlarni kuzatishingiz mumkin.\n\nDavom etish uchun telefon raqamingizni ulashing 👇',
  share_contact_btn: '📱 Telefon raqamni ulashish',
  linked_owner:
    '✅ Akkauntingiz bog\'landi!\nSiz <b>do\'kon egasi</b> sifatida kirdingiz.',
  linked_personal:
    '✅ Akkauntingiz bog\'landi!\nSiz <b>oddiy foydalanuvchi</b> sifatida kirdingiz.',
  not_found:
    '❌ Bu telefon raqami tizimda topilmadi.\n\nRo\'yxatdan o\'tish uchun "📱 Telefon raqamni ulashish" tugmasini bosing yoki /register buyrug\'ini yuboring.',
  session_expired: '⏳ Sessiya muddati tugadi. Iltimos, /start ni bosing.',
  error_generic: '⚠️ Xatolik yuz berdi: {msg}',
  cancelled: 'Bekor qilindi.',
  cancel_btn: '❌ Bekor qilish',

  // --- Main menu ---
  menu_title:
    '<b>Temir Daftar — Asosiy Menyusi</b> 📋\n\n💡 <b>Qarzlarni 2 xil usulda yozishingiz mumkin:</b>\n\n1️⃣ <b>🤖 AI Yordamchi (Eng osoni):</b>\nForma to\'ldirmasdan, shunchaki chatga oddiy matn yozing!\n<i>Masalan:</i> <code>Ali 100ming som dushanba</code>\n\n2️⃣ <b>📋 Menyudagi tugmalar:</b>\nTugmalar orqali bosqichma-bosqich yozing.\n\nAmalni tanlang 👇',
  menu_ai: '🤖 AI Yordamchi',
  menu_add_debt: '➕ Qarz yozish',
  menu_reduce_debt: '➖ Qarz o\'chirish',
  menu_debtors: '👥 Qarzdorlar',
  menu_dashboard: '📊 Hisobot',
  menu_daily_sales: '💰 Kunlik savdo',
  menu_subscription: '💳 Obuna',
  menu_webapp: '📲 Mini-ilova',
  menu_lang: '🌐 Til',

  // --- AI Guide ---
  ai_guide_text:
    '🤖 <b>AI Yordamchi — Qanday ishlaydi?</b>\n\nAI yordamida qarz yozish uchun maxsus forma to\'ldirish shart emas. Shunchaki oddiy gap ko\'rinishida yozing!\n\n<b>📌 Misollar:</b>\n• <code>Ali 100ming som dushanba</code>\n• <code>Vali 500.000 juma nos sotib oldi</code>\n• <code>Sardor 1.5 mln kelasi hafta</code>\n• <code>Jasur 200$ ertaga</code>\n\n✨ AI matndan <b>ism, summa, muddat va izohni</b> avtomatik aniqlaydi va sizdan faqat tasdiqlashni so\'raydi.\n\n<i>Hoziroq sinab ko\'rish uchun pastdagi tugmani bosing yoki chatga matn yozing!</i>',
  ai_demo_btn: '🧪 Namuna bilan sinab ko\'rish',
  ai_demo_success: '🧪 AI namunasi ishlatildi!',

  // --- Subscription / tariffs (manual payment via admin) ---
  sub_header: '💳 <b>Obuna va tariflar</b>',
  sub_current:
    'Joriy tarif: <b>{plan}</b>\nHolat: <b>{status}</b>\nAmal qiladi: <b>{until}</b> ({days} kun qoldi)',
  sub_status_trial: 'Sinov muddati',
  sub_status_active: 'Faol',
  sub_status_expired: 'Muddati tugagan',
  sub_status_blocked: 'Bloklangan',
  sub_plans_header: '<b>Tariflar:</b>',
  sub_plan_line: '• <b>{name}</b> — {price} · {debtors} mijoz · {sms} SMS',
  sub_price: '{amount} so\'m/oy',
  sub_free: 'Bepul',
  sub_unlimited: 'cheksiz',
  sub_contact_btn: '✍️ Adminga yozish',
  sub_how:
    '<i>To\'lov admin orqali amalga oshiriladi: yozing, rekvizitlarni oling, to\'lovdan so\'ng obuna darhol faollashtiriladi.</i>',
  sub_no_contact:
    '⚠️ Admin kontakti sozlanmagan. Iltimos, xizmat ko\'rsatuvchi bilan bog\'laning.',
  sub_phone: '📞 {phone}',

  // --- Add debt flow ---
  ask_mode: 'Tanlang:',
  btn_new_debtor: '🆕 Yangi qarzdor',
  btn_select_existing: '📋 Mavjudlardan tanlash',
  ask_select_debtor: 'Qarzdorni tanlang:',
  debtors_not_found_new: 'Mavjud qarzdorlar topilmadi. Yangi qarzdor qo\'shamiz.',
  ask_debtor_name: 'Qarzdorning ismini kiriting:',
  ask_debtor_phone:
    'Qarzdorning telefon raqami yoki ID (ixtiyoriy, o\'tkazib yuborish uchun "-"):',
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
  debtors_truncated: 'Faqat dastlabki {shown} ta ko\'rsatildi ({total} tadan).',
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
  reg_need_contact:
    'Ro\'yxatdan o\'tish uchun avval telefon raqamingizni ulashing 👇',
  reg_done: '✅ Ro\'yxatdan o\'tdingiz! Endi qarzlaringizni yuritishingiz mumkin.',
  reg_success_msg:
    '🎉 <b>Ro\'yxatdan muvaffaqiyatli o\'tdingiz!</b>\n\n👤 <b>Ism:</b> {name}\n📱 <b>Telefon:</b> <code>{phone}</code>\n🏷️ <b>Maqsad:</b> {roleLabel}\n\n💡 <b>Qanday boshlash kerak?</b>\nShunchaki chatga qarz matnini yuboring (masalan: <code>Ali 50ming som ertaga</code>) yoki menyudagi 🤖 AI Yordamchi tugmasini bosing 👇',

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
    '❌ Bu raqam tizimda topilmadi.\n\n/register orqali bepul akkaunt ochishingiz mumkin.',

  pay_link_msg: '💳 <b>Bir martalik to\'lov havolasi:</b>\n\n{url}',
  receipt_share_msg: '📲 <b>Mijozga yuborish uchun havola tayyor</b>\n\nUshbu havolani mijozga o\'zingiz yuboring:\n{url}',

  // --- Duplicate debtor picker ---
  dup_found:
    '🔎 Shunga o\'xshash mijoz topildi. Kimga qarz yozamiz?',
  dup_new_btn: '➕ Yangi mijoz',
  dup_option: '{name}{phone} — {outstanding}',

  // --- Reduce debt ---
  ask_reduce_debtor: 'Qaysi qarzdordan qarz o\'chirilsin?',
  ask_reduce_amount: '<b>{name}</b> (Jami qarz: {outstanding} so\'m)\n\nQancha qarz o\'chiriladi / qaytarildi? (summani kiriting):',
  reduce_amount_invalid: 'Iltimos, to\'g'ri summa kiriting (masalan: 100000).',
  reduce_success: '✅ <b>{name}</b> dan <b>{amount} so'm</b> qarz o\'chirildi.\n\n💰 Qolgan qarz: <b>{remaining} so'm</b>',
  no_debt_to_reduce: 'Ushbu qarzdorda o\'chirish uchun ochiq qarz topilmadi.',
};
