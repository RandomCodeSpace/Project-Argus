# ARGUS V5.0 Chaos Test Simulation
# Builds and starts all 3 test services, runs load test, then cleans up.
# Requires Argus backend to be running on :4317 (start with .\start_dev.ps1 first)

param(
    [int]$RequestCount = 300,
    [int]$Parallel = 1,
    [string]$TargetUrl = "http://localhost:9001/order"
)

$ErrorActionPreference = "Stop"
$TestDir = $PSScriptRoot
$RootDir = Split-Path $TestDir -Parent

Write-Host ""
Write-Host "================================" -ForegroundColor Magenta
Write-Host " ARGUS V5.0 Chaos Simulation" -ForegroundColor Magenta
Write-Host "================================" -ForegroundColor Magenta
Write-Host "  Requests:   $RequestCount"
Write-Host "  Parallelism: $Parallel"
Write-Host ""

# ── Build services ──
Write-Host "[1/4] Building test services..." -ForegroundColor Yellow
$tmpDir = Join-Path $RootDir "tmp"
if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null }

Push-Location $RootDir
go build -o "$tmpDir\orderservice.exe" ./test/orderservice
go build -o "$tmpDir\paymentservice.exe" ./test/paymentservice
go build -o "$tmpDir\inventoryservice.exe" ./test/inventoryservice
go build -o "$tmpDir\authservice.exe" ./test/authservice
go build -o "$tmpDir\userservice.exe" ./test/userservice
go build -o "$tmpDir\shippingservice.exe" ./test/shippingservice
go build -o "$tmpDir\notificationservice.exe" ./test/notificationservice
Pop-Location
Write-Host "  All services built" -ForegroundColor Green

# ── Start services ──
Write-Host "[2/4] Starting services..." -ForegroundColor Yellow

$userProc = Start-Process -FilePath "$tmpDir\userservice.exe" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 1

$authProc = Start-Process -FilePath "$tmpDir\authservice.exe" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 1

$inventoryProc = Start-Process -FilePath "$tmpDir\inventoryservice.exe" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 1

$shippingProc = Start-Process -FilePath "$tmpDir\shippingservice.exe" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 1

$notificationProc = Start-Process -FilePath "$tmpDir\notificationservice.exe" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 1

$paymentProc = Start-Process -FilePath "$tmpDir\paymentservice.exe" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 1

$orderProc = Start-Process -FilePath "$tmpDir\orderservice.exe" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 1

Write-Host "  User Service         (PID: $($userProc.Id))         -> :9005" -ForegroundColor Green
Write-Host "  Auth Service         (PID: $($authProc.Id))         -> :9004" -ForegroundColor Green
Write-Host "  Inventory Service    (PID: $($inventoryProc.Id))    -> :9003" -ForegroundColor Green
Write-Host "  Shipping Service     (PID: $($shippingProc.Id))     -> :9006" -ForegroundColor Green
Write-Host "  Notification Service (PID: $($notificationProc.Id)) -> :9007" -ForegroundColor Green
Write-Host "  Payment Service      (PID: $($paymentProc.Id))      -> :9002" -ForegroundColor Green
Write-Host "  Order Service        (PID: $($orderProc.Id))        -> :9001" -ForegroundColor Green
Write-Host ""

# ── Cleanup function ──
function Stop-TestServices {
    Write-Host ""
    Write-Host "[4/4] Cleaning up..." -ForegroundColor Yellow
    @($orderProc, $paymentProc, $inventoryProc, $authProc, $userProc, $shippingProc, $notificationProc) | ForEach-Object {
        try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    Remove-Item "$tmpDir\orderservice.exe", "$tmpDir\paymentservice.exe", "$tmpDir\inventoryservice.exe", "$tmpDir\authservice.exe", "$tmpDir\userservice.exe", "$tmpDir\shippingservice.exe", "$tmpDir\notificationservice.exe" -Force -ErrorAction SilentlyContinue
    Write-Host "  All test services stopped" -ForegroundColor Green
}

# Register cleanup on Ctrl+C
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-TestServices } -ErrorAction SilentlyContinue

# ── Load test ──
Write-Host "[3/4] Running load test..." -ForegroundColor Yellow
Write-Host ""

$startTime = Get-Date

try {
    if ($Parallel -gt 1) {
        # Parallel execution
        Write-Host "  Starting parallel execution with $Parallel threads..." -ForegroundColor Cyan
        
        $total = 0
        $success = 0
        $failure = 0

        while ($true) {
            $results = 1..$Parallel | ForEach-Object -Parallel {
                $url = $using:TargetUrl
                try {
                    $response = Invoke-WebRequest -Uri $url -Method POST -TimeoutSec 10 -ErrorAction Stop
                    if ($response.StatusCode -eq 200) { return "OK" } else { return "FAIL" }
                }
                catch {
                    return "FAIL"
                }
            } -ThrottleLimit $Parallel

            $success += ($results | Where-Object { $_ -eq "OK" }).Count
            $failure += ($results | Where-Object { $_ -eq "FAIL" }).Count
            $total += $results.Count

            Write-Host "  Progress: $total requests | OK: $success | FAIL: $failure" -ForegroundColor Cyan
        }
    }
    else {
        # Sequential execution
        $total = 0
        $success = 0
        $failure = 0

        while ($true) {
            try {
                $response = Invoke-WebRequest -Uri $TargetUrl -Method POST -TimeoutSec 10 -ErrorAction SilentlyContinue
                if ($response.StatusCode -eq 200) { $success++ } else { $failure++ }
            }
            catch {
                $failure++
            }
            $total++

            if ($total % 30 -eq 0) {
                Write-Host "  Progress: $total requests | OK: $success | FAIL: $failure" -ForegroundColor Cyan
            }
            
            # Small delay only in sequential mode to avoid flooding if requested
            Start-Sleep -Milliseconds 50
        }
    }
}
finally {
    Stop-TestServices
}

$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds
$rps = if ($duration -gt 0) { [math]::Round($total / $duration, 1) } else { 0 }

Write-Host ""
Write-Host "================================" -ForegroundColor Magenta
Write-Host " Simulation Complete" -ForegroundColor Magenta
Write-Host "================================" -ForegroundColor Magenta
$errorRate = if ($total -gt 0) { [math]::Round(($failure / $total) * 100, 1) } else { 0 }
Write-Host "  Total Requests: $total"
Write-Host "  Duration:       $([math]::Round($duration, 2)) s"
Write-Host "  RPS:            $rps req/s"
Write-Host "  Successful:     $success" -ForegroundColor Green
Write-Host "  Failed:         $failure" -ForegroundColor Red
Write-Host "  Error Rate:     $errorRate%" -ForegroundColor $(if ($errorRate -gt 20) { "Red" } else { "Yellow" })
Write-Host ""
