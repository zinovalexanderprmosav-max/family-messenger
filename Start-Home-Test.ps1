$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host ""
Write-Host "Family Messenger 0.3.8-rc1 - Home Test" -ForegroundColor Cyan
Write-Host "1/3 Starting server..." -ForegroundColor Yellow

docker version | Out-Null
docker compose -f docker-compose.home.yml up -d --build

$healthOk = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:10000/health" -TimeoutSec 2
    if ($health.status -eq "ok") { $healthOk = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $healthOk) {
  docker compose -f docker-compose.home.yml logs app
  throw "Server did not become ready."
}

Write-Host "2/3 Server is ready." -ForegroundColor Green

$Tools = Join-Path $Root ".tools"
New-Item -ItemType Directory -Force -Path $Tools | Out-Null
$Cloudflared = Join-Path $Tools "cloudflared.exe"
if (-not (Test-Path $Cloudflared)) {
  Write-Host "Downloading Cloudflare tunnel..." -ForegroundColor Yellow
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $Cloudflared
}

$Out = Join-Path $Tools "cloudflared.out.log"
$Err = Join-Path $Tools "cloudflared.err.log"
Remove-Item $Out,$Err -ErrorAction SilentlyContinue

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $Cloudflared -ArgumentList @("tunnel","--url","http://127.0.0.1:10000","--no-autoupdate") -RedirectStandardOutput $Out -RedirectStandardError $Err -WindowStyle Hidden

Write-Host "3/3 Creating HTTPS address..." -ForegroundColor Yellow
$url = $null
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  $text = ""
  if (Test-Path $Out) { $text += Get-Content $Out -Raw -ErrorAction SilentlyContinue }
  if (Test-Path $Err) { $text += Get-Content $Err -Raw -ErrorAction SilentlyContinue }
  $match = [regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) { $url = $match.Value; break }
}
if (-not $url) {
  throw "Could not create HTTPS tunnel. See .tools\cloudflared.err.log"
}

Set-Content -Path (Join-Path $Root "HOME-TEST-URL.txt") -Value $url -Encoding UTF8

Write-Host ""
Write-Host "READY" -ForegroundColor Green
Write-Host "Open this address on PC and iPhone:" -ForegroundColor Cyan
Write-Host $url -ForegroundColor White
Write-Host ""
Write-Host "On iPhone: Safari -> Share -> Add to Home Screen." -ForegroundColor Gray
Write-Host "Keep this PC running during the home test." -ForegroundColor Gray
Write-Host ""
Start-Process $url
Read-Host "Press Enter to close this window (server will keep running)"
