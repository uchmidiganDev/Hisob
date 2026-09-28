# Hisob-kitob — Telegram Mini App

O‘zbek tilidagi qarz va xarajatlar kundaligi. Node.js 24, native SQLite, Telegram Bot API. Tashqi npm paket talab qilinmaydi.

## Imkoniyatlar
- Qarz olish va berish: sabab, kimdan/kimga, summa, sana va muddat.
- Qarzlarni tahrirlash, o‘chirish, qaytarildi deb belgilash va qayta ochish.
- Xarajat nomi, summa, kategoriya va xarid sanasi; tahrirlash, o‘chirish va qidirish.
- Kunlik, oylik, yillik jami; so‘nggi 7 kun diagrammasi.
- Toshkent vaqti bo‘yicha 00:00 da kechagi kun hisoboti; oyning 1-kuni oldingi oy, 1-yanvarda oldingi yil hisoboti.
- Qarz muddatida 09:00 dan boshlab, yopilguncha har kuni eslatma.
- Telegram imzosi serverda tekshiriladi. Har kim faqat o‘z yozuvlarini ko‘radi.
- Summalar butun tiyinda saqlanadi. Barcha summalar UZS.
- Qarz va xarajatlar alohida: qarzni yopish xarajatni avtomatik qo‘shmaydi.
- Sozlamalarda xabarlarni boshqarish; `/stop` ham barcha eslatmalarni o‘chiradi.

## Railway’da ishga tushirish
1. GitHub repodan yangi Railway service yarating (Dockerfile avtomatik aniqlanadi).
2. **Volume** qo‘shing, mount path: `/data`. Bu majburiy: bazani redeploy paytida saqlaydi.
3. Public Networking → Generate Domain orqali HTTPS domen yarating.
4. Variables:
   - `BOT_TOKEN`: BotFather tokeni. Uni GitHub fayliga yoki README’ga yozmang.
   - `APP_URL`: yuqorida yaratilgan `https://...up.railway.app` manzili.
   - `DB_PATH`: `/data/app.sqlite`.
   - `NODE_ENV`: `production` (Docker image’da bor).
   - Ixtiyoriy `ALLOWED_USER_IDS`: faqat ruxsatli Telegram IDlar, vergul bilan. Bo‘sh bo‘lsa barcha foydalanuvchilar o‘z alohida hisobiga kira oladi.
5. **Bitta replica**, bitta Node jarayoni ishlasin. Serverless / sleep rejimini o‘chiring: bot 24/7 ishlashi kerak.
6. Deploy qiling. `/health` 200 javob beradi. Bot avtomatik menu va `/start` tugmasini sozlaydi.
7. Botga `/start` yuboring, «Hisob-kitobni ochish»ni bosing. BotFather’da qo‘shimcha Main Mini App sozlamasi ixtiyoriy.
8. Railway Volume backup’larini yoqing va qayta tiklashni sinang.

Token va haqiqiy Telegram ulanishi hali ishga tushmagan lokal tekshiruvda ishlatilmaydi. Deploydan keyin haqiqiy `/start`, Mini App kirishi va sinov eslatmasi tekshirilishi kerak.

## Lokal ishga tushirish
Node.js 24 yoki yangiroq:
```bash
cp .env.example .env
npm start
```
`.env` ichiga token, HTTPS tunnel manzili va `DB_PATH=./data/app.sqlite` kiriting. Telegram Mini App HTTPS talab qiladi. Oddiy brauzerdan kirish autentifikatsiyasiz ma’lumotlarni ochmaydi. Tokensiz ishga tushirilsa faqat veb sahifa va health endpoint ishlaydi.

## Tekshiruvlar
```bash
npm test
```
Avtomatik testlar: Telegram HMAC, eskirgan/tahrirlangan kirish ma’lumotlari, sana va pul validatsiyasi, API CRUD, boshqa foydalanuvchining yozuvlarini o‘zgartira olmaslik, restartdan so‘ng saqlanish, Toshkent yarim tuni, yil/oy chegaralari, eslatmalar va o‘tkazib yuborilgan kunlarni tiklash.

## Ishlash xususiyatlari
- Scheduler 10 soniyada tekshiradi; normal holatda xabar belgilangan vaqtdan keyingi 10 soniyada navbatga qo‘yiladi. Telegram cheklovi yoki tarmoq uzilishi yetkazishni kechiktirishi mumkin.
- Doimiy SQLite outbox bir xil hisobotni qayta navbatga qo‘shmaydi, vaqtinchalik xatolar qayta uriniladi. Telegram yuborishni qabul qilganidan keyin jarayon keskin uzilsa, tasdiq bazaga yozilmay qolib, takroriy xabar kelishi mumkin (at-least-once delivery).
- Server ishlamagan kunlarning hisobotlari restartdan so‘ng tiklanadi; qarzlar uchun hozirgi kunning eslatmasi yuboriladi.
- Oldingi davr yozuvi keyin tahrirlansa Mini App jami yangilanadi, oldin yuborilgan Telegram hisoboti qayta yuborilmaydi.
- Sessiya 1 soat; muddati tugasa Mini App’ni qayta oching.
- Webhook o‘chirilib, long polling ishlatiladi. Shu token bilan boshqa bot jarayonini parallel ishlatmang.
- SQLite volume uchun bitta replica mo‘ljallangan. Bir nechta replica kerak bo‘lsa PostgreSQL va distributed job lock’ga o‘tish kerak.

## Tuzilishi
- `server.js`: HTTP API, Telegram polling, scheduler va yetkazish.
- `core.js`: kirish imzosi, validatsiya, baza va hisobotlar.
- `public/`: mobil interfeys.
- `test/`: avtomatik testlar.
- `Dockerfile`, `railway.json`: deployment sozlamalari.
