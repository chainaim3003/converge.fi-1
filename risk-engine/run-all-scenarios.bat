@echo off
REM ============================================
REM RiskStableCoin - 16 Scenario Test Runner
REM Run this in Windows Command Prompt
REM ============================================

set ACTUS_URL=http://34.203.247.32:8083/eventsBatch
set BR=100
set LR=20
set CL=40
set QT=80

echo ============================================
echo   RiskStableCoin - 16 Scenario Test Suite
echo ============================================
echo.

echo Scenario 01: All Pass
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-01-all-pass.json
echo.

echo Scenario 02: Quality Fails
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-02-quality-fail.json
echo.

echo Scenario 03: Concentration Fails
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-03-concentration-fail.json
echo.

echo Scenario 04: Concentration + Quality Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-04-concentration-quality-fail.json
echo.

echo Scenario 05: Liquidity Fails
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-05-liquidity-fail.json
echo.

echo Scenario 06: Liquidity + Quality Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-06-liquidity-quality-fail.json
echo.

echo Scenario 07: Liquidity + Concentration Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-07-liquidity-concentration-fail.json
echo.

echo Scenario 08: Only Backing Passes
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-08-only-backing-pass.json
echo.

echo Scenario 09: Backing Fails
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-09-backing-fail.json
echo.

echo Scenario 10: Backing + Quality Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-10-backing-quality-fail.json
echo.

echo Scenario 11: Backing + Concentration Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-11-backing-concentration-fail.json
echo.

echo Scenario 12: Backing + Concentration + Quality Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-12-backing-concentration-quality-fail.json
echo.

echo Scenario 13: Backing + Liquidity Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-13-backing-liquidity-fail.json
echo.

echo Scenario 14: Backing + Liquidity + Quality Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-14-backing-liquidity-quality-fail.json
echo.

echo Scenario 15: Only Quality Passes
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-15-only-quality-pass.json
echo.

echo Scenario 16: All Fail
node dist/index.js --backingRatio %BR% --liquidityRatio %LR% --concentrationLimit %CL% --qualityThreshold %QT% --actusUrl %ACTUS_URL% --portfolio ./config/test-scenarios/scenario-16-all-fail.json
echo.

echo ============================================
echo   All 16 Scenarios Complete!
echo ============================================
pause
