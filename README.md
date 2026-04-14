# WABOT MULTI Web

Bundle ini khusus untuk versi web saja.

## File yang dipakai

- `multi_user_web.cjs`
- `public_multi/`
- `package.json`
- `package-lock.json`
- `.replit`
- `DEPLOY_REPLIT.md`
- `pesan.txt`

## Jalankan lokal

```bash
npm install
npm start
```

Lalu buka:

```text
http://127.0.0.1:3000
```

Kalau mau dibuka teman satu Wi-Fi, lihat URL LAN yang dicetak di terminal saat app start, misalnya `http://192.168.x.x:3000`.

## Biar bisa publik

Repo ini sudah siap di-deploy sebagai web app publik karena server bind ke `0.0.0.0` dan memakai port dari environment.

Kalau dipasang di Replit atau platform lain, pastikan:

- `PORT` diset oleh platform
- `HOST=0.0.0.0`
- proses dijalankan dengan `npm start`
- Windows Firewall mengizinkan Node.js/Python/port yang dipakai

Kalau teman ada di jaringan yang sama tapi tetap tidak bisa buka, biasanya firewall Windows yang memblokir port. Izinkan app ini masuk lewat Private Network, atau buka port `3000` di firewall.

## VS Code

Kalau kamu buka repo ini di VS Code, pakai task bawaan:

- `Run App` untuk menjalankan server lokal
- `Run App on Port` untuk menjalankan server dengan `HOST=0.0.0.0` dan port tetap
- `Deploy: commit and push` untuk publish perubahan ke branch aktif di GitHub

Kalau mau debug langsung dari editor, pakai konfigurasi `Run App on Port` di panel Run and Debug. Saat diminta, isi port yang kamu mau.

## Upload ke GitHub

Yang di-push cukup isi folder ini saja.

## Deploy ke Replit

Lihat `DEPLOY_REPLIT.md`.
