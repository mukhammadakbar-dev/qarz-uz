# Runbook (production: `kissa.takallam.uz`)

Server, foydalanuvchi va yo‘llar: `docs/DEPLOY.md` → «Hozirgi production». Qisqacha:

| Narsa      | Qiymat                                                             |
| ---------- | ------------------------------------------------------------------ |
| SSH        | `ssh root@75.119.158.99`, ilova `kissa` foydalanuvchisi ostida     |
| Kod        | `/srv/kissa`                                                       |
| Sozlamalar | `/etc/nasiya/server.env`                                           |
| PM2        | `sudo -iu kissa pm2 status` / `pm2 logs nasiya --lines 100`        |
| Port       | `3100` (faqat Docker tarmog‘idan; Caddy orqali HTTPS)              |
| Zaxira     | `/var/backups/kissa`, log `/var/log/kissa-backup.log`              |
| Watchdog   | `/usr/local/bin/kissa-watchdog`, log `/var/log/kissa-watchdog.log` |

Quyida `$ENV=/etc/nasiya/server.env`.

## 0. Ogohlantirishlar qayerdan keladi

Hammasi `SUPERADMIN_TELEGRAM_IDS` dagi chat(lar)ga, @kissauzbot nomidan. Xabarlarda foydalanuvchi matni, summa yoki ism bo‘lmaydi.

| Xabar                                          | Manba                                       | Bo‘lim                      |
| ---------------------------------------------- | ------------------------------------------- | --------------------------- |
| ✅ Kissa ishga tushdi (`commit`)               | ilova (har start; crash-loop ham ko‘rinadi) | §1, §3                      |
| ⚠️ N daqiqada N ta kutilmagan xato             | ilova (5 daqiqada 5 ta, 30 daqiqada bir)    | §3                          |
| 🚨 N ta mijoz qoldig‘i ledger bilan mos emas   | ilova, soatlik reconciliation               | §5                          |
| ⚠️ obuna eslatmasi / ommaviy xabar yuborilmadi | ilova                                       | §3 (odatda Telegram tomoni) |
| 🚨 Kissa javob bermayapti / ✅ tiklandi        | watchdog (cron, 5 daqiqa)                   | §3                          |
| ⚠️ Telegram webhook: …                         | watchdog                                    | §4                          |
| 🚨 Kissa zaxira: …                             | `kissa-backup.sh`                           | §6                          |

Server butunlay o‘chsa (yoki tarmoq yo‘q bo‘lsa) yuqoridagilarning hech biri ishlamaydi. Buni tashqi tekshiruv qoplaydi: UptimeRobot (bepul) → HTTP monitor `https://kissa.takallam.uz/healthz`, 5 daqiqa, ogohlantirish email/Telegram'ga.

### O‘rnatish (bir marta, root)

```bash
cd /srv/kissa
install -m 755 deploy/notify.sh   /usr/local/bin/kissa-notify
install -m 755 deploy/watchdog.sh /usr/local/bin/kissa-watchdog
install -m 755 deploy/backup.sh   /usr/local/bin/kissa-backup.sh
install -m 644 deploy/watchdog.cron /etc/cron.d/kissa-watchdog
install -m 644 deploy/backup.cron   /etc/cron.d/kissa-backup
kissa-notify "Kissa: ogohlantirish kanali sinovi"   # superadmin chatiga kelishi kerak
```

`deploy/*.sh` o‘zgarsa shu `install` qatorlarini qayta bajaring (`deploy.sh` ularni avtomatik ko‘chirmaydi: u `kissa` foydalanuvchisi ostida ishlaydi).

## 1. Deploy

```bash
ssh root@75.119.158.99 'sudo -iu kissa bash -c "APP_DIR=/srv/kissa /srv/kissa/deploy/deploy.sh"'
```

`deploy.sh`: `git reset --hard origin/main` → install → build → migratsiya → `pm2 startOrReload` → `/readyz` 30 soniya. O‘tmasa avvalgi commitga o‘zi qaytadi. Muvaffaqiyatli bo‘lsa Telegram'ga «✅ Kissa ishga tushdi (`commit`)» keladi.

Deploy'dan keyin: `/start` botda, Mini App ochilishi, `pm2 logs nasiya --lines 50` da `error` yo‘qligi.

## 2. Rollback

Avtomatik qaytish ishlamagan yoki xato keyinroq bilingan bo‘lsa:

```bash
sudo -iu kissa
cd /srv/kissa && git log --oneline -5            # qaytiladigan commit
git reset --hard <commit>
pnpm install --frozen-lockfile && pnpm --filter @nasiya/server build && pnpm --filter @nasiya/miniapp build
pm2 startOrReload ecosystem.config.cjs --update-env
curl -fsS http://127.0.0.1:3100/readyz
```

Migratsiyalar orqaga qaytmaydi (ADR-0001): eski kod yangi sxema bilan ishlashi kerak (expand/contract). Agar yangi migratsiya eski kodni buzgan bo‘lsa — rollback emas, oldinga tuzatish (fix + deploy). Keyingi `deploy.sh` yana `origin/main` ni oladi: xatoli commitni `main` da revert qilmasdan qayta deploy qilmang.

## 3. Ilova javob bermayapti / ko‘p xato

1. `sudo -iu kissa pm2 status` — `errored` yoki restart soni tez o‘syaptimi?
2. `pm2 logs nasiya --lines 200 --err` — birinchi xato. Tez-tez uchraydiganlari:
   - `Noto‘g‘ri konfiguratsiya` — `server.env` dagi qiymat (xabarda o‘zgaruvchi nomi bor).
   - `ECONNREFUSED 5432` / `password authentication failed` — `systemctl status postgresql`, parol (§7).
   - Gemini xatolari ilovani to‘xtatmaydi: circuit breaker ochiladi va bot rule parser bilan ishlayveradi.
3. Baza: `curl -s http://127.0.0.1:3100/readyz` (`db` holati), `sudo -u postgres psql -c 'select 1' nasiya`.
4. Disk: `df -h /` (to‘lsa Postgres yozmaydi; `/var/backups/kissa` va `/var/log/nasiya` ni tekshiring).
5. Tuzatgach `pm2 restart nasiya`; watchdog 5 daqiqa ichida «✅ tiklandi» yuboradi.

Obuna eslatmasi / ommaviy xabar «yuborilmadi» ogohlantirishi — odatda Telegram tomoni (5xx, 429). Eslatmalar keyingi yurishda o‘zi qayta urinadi; ommaviy xabar holati Admin → Ommaviy xabar'da.

## 4. Webhook tiklash

Belgilar: bot javob bermaydi, ilova esa sog‘ (`/readyz` OK); watchdog «webhook xatosi» yoki «navbatda N ta yangilanish» deydi.

```bash
sudo -iu kissa
cd /srv/kissa/apps/server
node --env-file=/etc/nasiya/server.env dist/webhook-cli.js info   # last_error_message, pending_update_count
```

- `last_error_message: "Wrong response from the webhook: 401"` — `TELEGRAM_WEBHOOK_SECRET` Telegram'dagi bilan mos emas → `webhook-cli.js set`.
- `502/503` yoki `Connection refused` — ilova yoki Caddy: §3 va `docker ps` (takallam `web` konteyneri), `curl -I https://kissa.takallam.uz/healthz`.
- `SSL error` — Caddy sertifikati (takallam repo'sidagi `deploy/Caddyfile`).
- URL noto‘g‘ri/bo‘sh — `PUBLIC_BASE_URL` ni tekshirib `set`.

```bash
node --env-file=/etc/nasiya/server.env dist/webhook-cli.js set      # URL + secret + allowed_updates
```

`set` navbatdagi update'larni o‘chirmaydi: Telegram ularni qayta yuboradi, takrorlar `processed_updates` bilan, moliyaviy takrorlar idempotentlik kalitlari bilan to‘xtatiladi (ADR-0003). `deleteWebhook` + `drop_pending_updates` ishlatmang — foydalanuvchi xabarlari yo‘qoladi.

## 5. Qoldiq nomuvofiqligi (reconciliation mismatch)

`customer_balances` — proyeksiya, haqiqat manbai `ledger_entries` (ADR-0002). Ular har INSERT da bitta tranzaksiyada trigger orqali yangilanadi, shuning uchun nomuvofiqlik **bo‘lmasligi kerak** — bo‘lsa, bu bug yoki qo‘lda SQL o‘zgarishi.

1. **Yozuvni to‘xtatmang, lekin tuzatishdan oldin tekshiring.** Ro‘yxat:

   ```sql
   -- sudo -u postgres psql nasiya
   SELECT b.customer_id, b.business_id, b.balance, COALESCE(s.total, 0) AS ledger_sum, b.updated_at
     FROM customer_balances b
     LEFT JOIN (SELECT customer_id, sum(delta) AS total FROM ledger_entries GROUP BY customer_id) s
       ON s.customer_id = b.customer_id
    WHERE b.balance <> COALESCE(s.total, 0);
   ```

2. Sababini toping: shu mijozning oxirgi yozuvlari (`SELECT * FROM ledger_entries WHERE customer_id = '…' ORDER BY created_at DESC LIMIT 20`), `audit_log`, o‘sha vaqtdagi `pm2 logs`. Qo‘lda `UPDATE`/`DELETE` bo‘lganmi? Trigger o‘chirilganmi (`\d ledger_entries`)?
3. Ledger to‘g‘ri bo‘lsa, proyeksiyani ledger'dan qayta hisoblang (bir tranzaksiyada, `BEGIN … COMMIT`):

   ```sql
   BEGIN;
   UPDATE customer_balances b
      SET balance = COALESCE((SELECT sum(delta) FROM ledger_entries e WHERE e.customer_id = b.customer_id), 0),
          updated_at = now()
    WHERE b.customer_id IN ('…');
   -- 1-qadamdagi so'rov endi bo'sh bo'lishi kerak
   COMMIT;
   ```

   `balance >= 0` CHECK buzilsa — ledger'ning o‘zida muammo: `ROLLBACK`, ledger'ga tegmang (u immutable), biznes egasi bilan gaplashib storno/tuzatish yozuvini ilova orqali kiriting.

4. Sababni tuzatib (kod bo‘lsa — test bilan), bu yerga qisqa yozing.

## 6. Zaxira va tiklash

Har kuni 03:30 (Toshkent) `kissa-backup.sh`: `pg_dump -Fc` → vaqtinchalik bazaga **tiklab tekshiradi** → 14 kun saqlaydi → `BACKUP_PASSPHRASE` va `BACKUP_TELEGRAM_CHAT_ID` berilgan bo‘lsa gpg (AES256) bilan shifrlab Telegram chatiga yuboradi (offsite). Har qanday xato → «🚨 Kissa zaxira».

**RPO** (yo‘qotilishi mumkin bo‘lgan ma’lumot): ≤ 24 soat. **RTO** (tiklash vaqti): ~15 daqiqa (pilot hajmida). WAL/PITR hozircha yo‘q: pilotdan keyin hajm o‘sganda qayta ko‘riladi (T6.5).

Offsite sozlash (`$ENV` ga, `chmod 600` saqlansin):

```ini
BACKUP_PASSPHRASE=<openssl rand -base64 32>       # parol menejeriga ham — busiz nusxani ochib bo‘lmaydi
BACKUP_TELEGRAM_CHAT_ID=<superadmin chat yoki yopiq kanal ID>
```

Shifrlangan nusxa 49 MB dan oshsa skript xato beradi: unda S3-mos saqlashga o‘tish kerak.

### Tiklash (favqulodda)

```bash
sudo -iu kissa pm2 stop nasiya
# offsite nusxadan bo'lsa avval: gpg -d -o nasiya.dump nasiya-YYYYMMDD-HHMM.dump.gpg
sudo -u postgres dropdb nasiya
sudo -u postgres createdb -O nasiya_migrator nasiya
sudo -u postgres pg_restore -d nasiya < /var/backups/kissa/<fayl>.dump
sudo -iu kissa pm2 start nasiya
curl -fsS http://127.0.0.1:3100/readyz
```

So‘ng: §5 dagi reconciliation so‘rovi bo‘sh, botda bitta biznesning qoldig‘i ko‘rinadi. Nusxadan keyingi yozuvlar yo‘qoladi: egalariga xabar bering.

### Tiklash mashqi (oyiga bir)

Kunlik skript har nusxani avtomatik tiklab tekshiradi; oylik mashq — **offsite** nusxadan, inson qo‘li bilan:

1. Telegram'dagi oxirgi `.dump.gpg` ni yuklab oling, parol menejeridagi parol bilan `gpg -d`.
2. Lokal Postgres'da `createdb kissa_drill && pg_restore -d kissa_drill --no-owner nasiya.dump`.
3. `SELECT count(*) FROM ledger_entries;` va §5 so‘rovi (bo‘sh bo‘lishi kerak).
4. Vaqtni yozing va bazani o‘chiring: `dropdb kissa_drill`.

| Sana | Nusxa | Natija | Vaqt |
| ---- | ----- | ------ | ---- |
|      |       |        |      |

## 7. Secret rotation

Sizib chiqqan deb gumon qilinsa — darhol; aks holda yiliga bir.

| Secret                    | Qanday almashtiriladi                                                                                                                                  | Ta’siri                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | BotFather → `/revoke` → yangi token `$ENV` ga → `pm2 restart nasiya --update-env` → `webhook-cli.js set`                                               | Eski token darhol o‘ladi; `set` gacha bot javob bermaydi       |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32` → `$ENV` → `pm2 restart nasiya --update-env` → **darhol** `webhook-cli.js set`                                                  | Restart va `set` orasida webhook 401 (Telegram qayta yuboradi) |
| `SESSION_SECRET`          | `openssl rand -hex 32` → `$ENV` → restart                                                                                                              | Ochiq Mini App sessiyalari yaroqsiz: qayta ochish kifoya       |
| DB parollari (3 rol)      | `sudo -u postgres psql -c "ALTER ROLE nasiya_app PASSWORD '…'"` (migrator, system ham) → `$ENV` dagi URL'lar → restart                                 | Restart'gacha yangi ulanishlar xato                            |
| `GEMINI_API_KEY`          | Google AI Studio'da yangi kalit → `$ENV` → restart → eskisini o‘chirish                                                                                | Yo‘q (o‘tishda rule parser ishlaydi)                           |
| `BACKUP_PASSPHRASE`       | Yangisi `$ENV` ga va parol menejeriga. **Eski parolni o‘chirmang**: eski offsite nusxalar u bilan ochiladi (14 kun yoki o‘sha nusxalar o‘chirilguncha) | Yo‘q                                                           |
| `SENTRY_DSN`              | Sentry → Client Keys → yangi DSN → `$ENV` → restart → eski kalitni o‘chirish                                                                           | Yo‘q                                                           |

Almashtirgandan keyin: `pm2 logs nasiya --lines 30` (konfiguratsiya xatosi yo‘q), botda `/start`, Mini App ochiladi, `kissa-notify "sinov"` keladi.
