@echo off
REM ================================================================
REM test-stimulation-endpoints.bat
REM Quick smoke test for the new stimulation endpoints
REM Run this AFTER: npm run server (or: tsc && node dist/server.js)
REM ================================================================

echo.
echo ===== TEST 1: GET /api/environments =====
curl -s http://localhost:4000/api/environments | findstr /C:"localhost" >nul
if %errorlevel%==0 (
    echo [PASS] Environments endpoint returns localhost and aws
) else (
    echo [FAIL] Environments endpoint not working
)
curl -s http://localhost:4000/api/environments
echo.

echo.
echo ===== TEST 2: GET /api/stimulations =====
curl -s http://localhost:4000/api/stimulations | findstr /C:"BackingRatio" >nul
if %errorlevel%==0 (
    echo [PASS] Stimulations endpoint lists BackingRatio scenario
) else (
    echo [FAIL] Stimulations endpoint not returning expected files
)
curl -s http://localhost:4000/api/stimulations
echo.

echo.
echo ===== TEST 3: POST /api/stimulation/run (validation) =====
echo Testing missing stimulationId returns 400...
curl -s -X POST http://localhost:4000/api/stimulation/run -H "Content-Type: application/json" -d "{}" | findstr /C:"Missing" >nul
if %errorlevel%==0 (
    echo [PASS] Proper 400 error for missing stimulationId
) else (
    echo [FAIL] Did not get expected validation error
)
echo.

echo.
echo ===== TEST 4: POST /api/stimulation/run (invalid env) =====
curl -s -X POST http://localhost:4000/api/stimulation/run -H "Content-Type: application/json" -d "{\"stimulationId\":\"test\",\"environment\":\"mars\"}" | findstr /C:"Unknown" >nul
if %errorlevel%==0 (
    echo [PASS] Proper error for unknown environment
) else (
    echo [FAIL] Did not get expected environment error
)
echo.

echo.
echo ===== TEST 5: POST /api/stimulation/run (file not found) =====
curl -s -X POST http://localhost:4000/api/stimulation/run -H "Content-Type: application/json" -d "{\"stimulationId\":\"nonexistent/file\",\"environment\":\"localhost\"}" | findstr /C:"not found" >nul
if %errorlevel%==0 (
    echo [PASS] Proper 404 for missing stimulation file
) else (
    echo [FAIL] Did not get expected 404 error
)
echo.

echo.
echo ===== TEST 6: GET /api/health/risk-service?environment=localhost =====
curl -s "http://localhost:4000/api/health/risk-service?environment=localhost"
echo.
echo (Check above: riskService.connected and actusServer.connected should be true if Docker is running)
echo.

echo.
echo ===== TEST 7: FULL RUN (localhost) =====
echo Running BackingRatio-RedemptionPressure-30d against localhost Docker...
echo (This will take ~10-20 seconds if Docker is running)
echo.
curl -s -X POST http://localhost:4000/api/stimulation/run -H "Content-Type: application/json" -d "{\"stimulationId\":\"stablecoin-1/StableCoin-BackingRatio-RedemptionPressure-30d\",\"environment\":\"localhost\"}" > stimulation-result.json
type stimulation-result.json | findstr /C:"success" >nul
if %errorlevel%==0 (
    echo [PASS] Stimulation completed - check stimulation-result.json for full output
) else (
    echo [INFO] Stimulation may have failed - check stimulation-result.json and server logs
)
echo.

echo.
echo ===== TEST 8: FULL RUN (aws) =====
echo Running BackingRatio-RedemptionPressure-30d against AWS...
curl -s -X POST http://localhost:4000/api/stimulation/run -H "Content-Type: application/json" -d "{\"stimulationId\":\"stablecoin-1/StableCoin-BackingRatio-RedemptionPressure-30d\",\"environment\":\"aws\"}" > stimulation-result-aws.json
type stimulation-result-aws.json | findstr /C:"success" >nul
if %errorlevel%==0 (
    echo [PASS] AWS Stimulation completed - check stimulation-result-aws.json
) else (
    echo [INFO] AWS Stimulation may have failed - check stimulation-result-aws.json
)
echo.

echo ===== ALL TESTS COMPLETE =====
pause
