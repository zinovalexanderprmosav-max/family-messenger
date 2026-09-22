$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
docker compose -f docker-compose.home.yml down
Write-Host "Family Messenger home test stopped."
