# SmartFinance PWA

Shaxsiy moliya boshqaruvchisi — 100% oflayn, ma'lumotlar faqat telefon/brauzer xotirasida (localStorage) saqlanadi. Server yo'q.

## Ishga tushirish

### 1-yo'l: GitHub Pages (tavsiya etiladi, kompyuter/telefon farqisiz)

1. Ushbu papkadagi barcha fayllarni (papkasiz, tekis holda) yangi GitHub repository'ga yuklang.
2. Repository **public** bo'lishi kerak (bepul GitHub Pages uchun shart).
3. Repo **Settings → Pages** bo'limida **Branch: main**, papka **/ (root)** ni tanlab **Save** bosing.
4. Bir necha soniyadan so'ng `https://username.github.io/repo-nomi/` manzilida ilova ishlaydi.

### 2-yo'l: Kompyuterda mahalliy server (dasturchilar uchun)

Service Worker `file://` orqali ishlamaydi — papkani mahalliy serverdan ochish kerak:

```bash
cd smartfinance
python3 -m http.server 8080
# so'ng brauzerda: http://localhost:8080
```

Yoki VS Code'dagi "Live Server" kengaytmasi, yoki `npx serve` bilan ham ochish mumkin.

### Telefonga o'rnatish

Ilova qaysi usulda (GitHub Pages yoki localhost) ochilishidan qat'i nazar, telefon brauzerida **"Bosh ekranga qo'shish / Add to Home Screen"** orqali odatiy ilova kabi o'rnatiladi va shundan keyin to'liq oflayn ishlaydi. Eslatma: `localhost` faqat o'sha kompyuterning o'zida ochiladi — telefonda ko'rish uchun GitHub Pages (yoki bir xil Wi-Fi tarmog'idagi IP manzil) kerak.

## Fayllar

- `index.html` — ilova qobig'i (onboarding, 4 ta ekran, modal oynalar)
- `style.css` — dizayn tokenlar, layout, light/dark mavzular
- `app.js` — barcha mantiq: holat boshqaruvi, taqsimot hisob-kitobi, oylik davr/otchot, grafiklar
- `manifest.json` — PWA metama'lumotlari
- `sw.js` — oflayn kesh (Service Worker)
- `icons/` — ilova ikonkalari

## Asosiy imkoniyatlar

- Onboarding: maosh summasi va maosh kuni
- 7 ta standart kategoriya, 25/15/15/15/15/10/5% taqsimot — foizlarni sozlamalardan o'zgartirish, kategoriya qo'shish/o'chirish mumkin
- Tezkor xarajat kiritish (kalkulyator klaviaturasi)
- Yashil/sariq/qizil limit indikatorlari
- Tahlil: kategoriya bo'yicha donut diagramma, kunlik ustunli grafik
- Maosh kuniga asoslangan oylik davr va yakuniy hisobot (muvaffaqiyat foizi, oshgan/tejalgan kategoriyalar, tavsiya)
- JSON eksport / import (zaxira nusxa)
- Qorong'i rejim
