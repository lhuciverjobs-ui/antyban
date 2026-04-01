# Deploy ke Replit

Project ini sudah disiapkan untuk jalan sebagai web app multi-user di Replit.

## 1. Import project

- Buat Repl Node.js baru atau import repo/folder ini ke Replit.

## 2. Install dependency

Di Shell Replit:

```bash
npm install
```

## 3. Jalankan lokal di Replit workspace

Run command:

```bash
npm start
```

Lalu buka preview Replit.

## 4. Publish

Replit docs saat ini menyarankan deployment tipe **Reserved VM** untuk app yang harus selalu hidup dan bot yang perlu koneksi terus-menerus.

Build command:

```bash
npm install
```

Run command:

```bash
npm start
```

Port:

- internal `3000`
- external `80`

## 5. Secrets / environment variables

Minimal:

- `PORT=3000`
- `HOST=0.0.0.0`

Default repo ini sekarang sudah membawa dependency `puppeteer`, jadi saat `npm install` browser Chrome akan ikut disiapkan otomatis.

Optional jika Chromium bawaan Replit tetap perlu dipakai manual:

- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

Atau:

- `CHROME_PATH=/usr/bin/chromium`

## 6. Catatan penting

- Session user web disimpan di `multi_user_data/users.json`
- Session WhatsApp disimpan di folder `.wwebjs_multi_auth`
- User web akan tetap ada setelah restart selama storage Replit tidak dibuang
- Login web akan tetap minta login ulang setelah restart server karena token disimpan di memori
- Untuk bot WhatsApp seperti ini, Reserved VM lebih cocok daripada Scheduled Deployment atau Static Deployment

## 7. Health check

Endpoint health:

```text
/health
```

## 8. Kalau WhatsApp gagal connect di Replit

Cek log deployment. Biasanya penyebabnya salah satu dari ini:

- Chromium path perlu diisi lewat `PUPPETEER_EXECUTABLE_PATH`
- resource VM terlalu kecil
- session WhatsApp putus dan perlu connect ulang
