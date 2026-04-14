param(
  [string]$Message = "public deploy"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$branch = (git branch --show-current).Trim()
if (-not $branch) {
  throw "Tidak bisa membaca branch aktif."
}

git add -A

$status = git status --short
if (-not $status) {
  Write-Host "Tidak ada perubahan untuk dikirim."
  exit 0
}

git commit -m $Message
git push -u origin $branch

Write-Host "Publish selesai untuk branch $branch."
