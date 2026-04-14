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

## Biar bisa publik

Repo ini sudah siap di-deploy sebagai web app publik karena server bind ke `0.0.0.0` dan memakai port dari environment.

Kalau dipasang di Replit atau platform lain, pastikan:

- `PORT` diset oleh platform
- `HOST=0.0.0.0`
- proses dijalankan dengan `npm start`

## Upload ke GitHub

Yang di-push cukup isi folder ini saja.

## Deploy ke Replit

Lihat `DEPLOY_REPLIT.md`.
