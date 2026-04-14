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

## Cloudflare Tunnel

Kalau mau kasih link publik ke teman, jalankan:

```bash
npm run tunnel
```

Script ini akan:

- menyalakan app di background
- menunggu server siap di port `3000`
- menjalankan Cloudflare Tunnel
- menampilkan `Public URL` di terminal

Catatan:

- `cloudflared` harus sudah terpasang di mesin kamu
- link `trycloudflare.com` biasanya bersifat sementara
- kalau terminal masih dipakai tunnel, itu normal

## Upload ke GitHub

Yang di-push cukup isi folder ini saja.

## Deploy ke Replit

Lihat `DEPLOY_REPLIT.md`.
