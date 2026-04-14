param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  throw "cloudflared tidak ditemukan. Install Cloudflare Tunnel dulu, lalu jalankan lagi `npm run tunnel`."
}

$nodeProcess = Start-Process `
  -FilePath "node" `
  -ArgumentList "multi_user_web.cjs" `
  -WorkingDirectory $PWD `
  -Environment @{
    HOST = "0.0.0.0"
    PORT = "$Port"
  } `
  -PassThru

Write-Host "App dijalankan di background dengan PID $($nodeProcess.Id)."
Write-Host "Menunggu server siap di http://127.0.0.1:$Port ..."

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  try {
    Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing | Out-Null
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
  throw "Server tidak siap di port $Port."
}

Write-Host "Server siap. Menjalankan Cloudflare Tunnel..."
Write-Host "Tunggu baris yang berisi URL https://*.trycloudflare.com"

try {
  & cloudflared tunnel --url "http://127.0.0.1:$Port" --no-autoupdate 2>&1 | ForEach-Object {
    $_
    if ($_ -match 'https://[A-Za-z0-9.-]+trycloudflare\.com') {
      Write-Host ""
      Write-Host "Public URL: $($Matches[0])"
      Write-Host "Kirim link itu ke teman kamu."
    }
  }
} finally {
  if ($nodeProcess -and -not $nodeProcess.HasExited) {
    Stop-Process -Id $nodeProcess.Id -Force
  }
}
