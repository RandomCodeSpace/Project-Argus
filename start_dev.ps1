Write-Host "Starting ARGUS Development Environment..." -ForegroundColor Cyan
$env:DB_DRIVER = "mysql"

# 0. Kill existing processes to ensure a clean restart
Write-Host "Stopping existing services..." -ForegroundColor Yellow
Stop-Process -Name "air", "main", "orderservice", "paymentservice", "node", "argus" -ErrorAction SilentlyContinue -Force
Start-Sleep -Seconds 2
# 1. Start Backend (Air)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\Development\CodeName Argus'; air" -WindowStyle Normal

# 2. Start Order Service (Air)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\Development\CodeName Argus\test\orderservice'; air" -WindowStyle Minimized

# 3. Start Payment Service (Air)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\Development\CodeName Argus\test\paymentservice'; air" -WindowStyle Minimized

# 4. Start Frontend (Vite)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'd:\Development\CodeName Argus\web'; npm run dev" -WindowStyle Normal

Write-Host "All services started in separate windows." -ForegroundColor Green
Write-Host "Backend: http://localhost:8080"
Write-Host "Frontend: http://localhost:5173"
