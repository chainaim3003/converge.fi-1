# simulate-cron.ps1
#
# Simulates the CRE cron trigger by firing WF1 on a fixed schedule.
# Keeps the on-chain risk report fresh so the mint simulator never
# hits MintBlockedStale.
#
# Usage:
#   cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1
#   .\scripts\simulate-cron.ps1
#
# Default interval: every 10 minutes.
# Risk engine must already be running on port 3001 before starting this.

param(
    [int]$IntervalMinutes = 10
)

$WorkflowDir = "$PSScriptRoot\..\workflows\risk-monitoring"
$IntervalSeconds = $IntervalMinutes * 60

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Converge.fi CRE Cron Simulator" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Workflow dir : $WorkflowDir" -ForegroundColor Gray
Write-Host "  Interval     : every $IntervalMinutes minutes" -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$RunCount = 0

while ($true) {
    $RunCount++
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    Write-Host "[$Timestamp] --- CRE Cron Run #$RunCount ---" -ForegroundColor Yellow

    Push-Location $WorkflowDir
    try {
        cre workflow simulate --target local-simulation --broadcast --config config.json workflow.ts
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -eq 0) {
            Write-Host "[$Timestamp] WF1 completed successfully. On-chain report updated." -ForegroundColor Green
        } else {
            Write-Host "[$Timestamp] WF1 exited with code $ExitCode. Check risk engine logs." -ForegroundColor Red
        }
    } catch {
        Write-Host "[$Timestamp] WF1 threw an error: $_" -ForegroundColor Red
    } finally {
        Pop-Location
    }

    Write-Host "[$Timestamp] Next run in $IntervalMinutes minutes. Waiting..." -ForegroundColor Gray
    Write-Host ""
    Start-Sleep -Seconds $IntervalSeconds
}
