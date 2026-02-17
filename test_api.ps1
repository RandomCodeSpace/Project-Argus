$response = Invoke-RestMethod -Uri "http://localhost:8080/api/metrics/dashboard" -Method Get
Write-Host "Dashboard Stats Response:"
$response | Format-List
Write-Host "`nJSON:"
$response | ConvertTo-Json
