# ARGUS V5.0 Development Startup Script
# Starts: Backend (Air) + Frontend (Vite)
# Chaos test services are started separately via test/run_simulation.ps1

$ErrorActionPreference = "Stop"
$PidFile = Join-Path $PSScriptRoot ".dev-pids"

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host " ARGUS V5.0 (DEV MODE)" -ForegroundColor Cyan  
Write-Host " Starting Development Stack..." -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# ── Kill previous session ──
Write-Host "Cleaning up old processes..." -ForegroundColor Yellow

if (Test-Path $PidFile) {
    $oldPids = Get-Content $PidFile
    foreach ($procId in $oldPids) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $procId } | ForEach-Object {
                    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                }
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
        catch { }
    }
    Remove-Item $PidFile -Force
}

Get-Process -Name "argus" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# ── Start services ──
$pids = @()

# 1. Argus Backend
Write-Host "[1/2] Starting Argus Backend..." -ForegroundColor Green
$p = Start-Process pwsh -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot'; air" -PassThru
$pids += $p.Id

Start-Sleep -Seconds 5

# 2. Frontend Dev Server
Write-Host "[2/2] Starting Frontend Dev Server..." -ForegroundColor Green
$p = Start-Process pwsh -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\web'; npm run dev" -PassThru
$pids += $p.Id

# Save PIDs
$pids | Out-File $PidFile -Force

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host " Dev Stack Started!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Argus Backend:      http://localhost:8080" -ForegroundColor White
Write-Host "  Argus gRPC:         localhost:4317" -ForegroundColor White
Write-Host "  Frontend Dev:       http://localhost:5173" -ForegroundColor White
Write-Host "  Prometheus Metrics: http://localhost:8080/metrics" -ForegroundColor White
Write-Host "  Health Check:       http://localhost:8080/api/health" -ForegroundColor White
Write-Host ""
Write-Host "  To run chaos tests: .\test\run_simulation.ps1" -ForegroundColor DarkGray
Write-Host "  Re-run this script to restart cleanly." -ForegroundColor DarkGray
Write-Host ""
