#!/bin/bash
# ============================================
# RiskStableCoin - 16 Scenario Test Runner
# ============================================

ACTUS_URL="http://34.203.247.32:8083/eventsBatch"
BACKING_RATIO=100
LIQUIDITY_RATIO=20
CONCENTRATION_LIMIT=40
QUALITY_THRESHOLD=80

echo "============================================"
echo "  RiskStableCoin - 16 Scenario Test Suite"
echo "============================================"
echo ""
echo "Thresholds: Backing=${BACKING_RATIO}% Liquidity=${LIQUIDITY_RATIO}% Concentration=${CONCENTRATION_LIMIT}% Quality=${QUALITY_THRESHOLD}"
echo ""

PASSED=0
FAILED=0

run_test() {
    local SCENARIO=$1
    local FILE=$2
    local EXPECTED=$3
    local DESC=$4
    
    echo "━━━ Scenario ${SCENARIO}: ${DESC} ━━━"
    echo "Expected: ${EXPECTED}"
    
    node dist/index.js \
        --backingRatio ${BACKING_RATIO} \
        --liquidityRatio ${LIQUIDITY_RATIO} \
        --concentrationLimit ${CONCENTRATION_LIMIT} \
        --qualityThreshold ${QUALITY_THRESHOLD} \
        --actusUrl ${ACTUS_URL} \
        --portfolio ./config/test-scenarios/${FILE}
    
    local EXIT_CODE=$?
    
    if [ "${EXPECTED}" == "PASS" ] && [ ${EXIT_CODE} -eq 0 ]; then
        echo "✅ TEST PASSED"
        ((PASSED++))
    elif [ "${EXPECTED}" == "FAIL" ] && [ ${EXIT_CODE} -eq 1 ]; then
        echo "✅ TEST PASSED"
        ((PASSED++))
    else
        echo "❌ TEST FAILED - Unexpected result!"
        ((FAILED++))
    fi
    echo ""
}

run_test "01" "scenario-01-all-pass.json" "PASS" "All Pass"
run_test "02" "scenario-02-quality-fail.json" "FAIL" "Quality Fails"
run_test "03" "scenario-03-concentration-fail.json" "FAIL" "Concentration Fails"
run_test "04" "scenario-04-concentration-quality-fail.json" "FAIL" "Conc+Quality Fail"
run_test "05" "scenario-05-liquidity-fail.json" "FAIL" "Liquidity Fails"
run_test "06" "scenario-06-liquidity-quality-fail.json" "FAIL" "Liq+Quality Fail"
run_test "07" "scenario-07-liquidity-concentration-fail.json" "FAIL" "Liq+Conc Fail"
run_test "08" "scenario-08-only-backing-pass.json" "FAIL" "Only Backing Pass"
run_test "09" "scenario-09-backing-fail.json" "FAIL" "Backing Fails"
run_test "10" "scenario-10-backing-quality-fail.json" "FAIL" "Back+Quality Fail"
run_test "11" "scenario-11-backing-concentration-fail.json" "FAIL" "Back+Conc Fail"
run_test "12" "scenario-12-backing-concentration-quality-fail.json" "FAIL" "B+C+Q Fail"
run_test "13" "scenario-13-backing-liquidity-fail.json" "FAIL" "Back+Liq Fail"
run_test "14" "scenario-14-backing-liquidity-quality-fail.json" "FAIL" "B+L+Q Fail"
run_test "15" "scenario-15-only-quality-pass.json" "FAIL" "Only Quality Pass"
run_test "16" "scenario-16-all-fail.json" "FAIL" "All Fail"

echo "============================================"
echo "  TEST SUMMARY"
echo "============================================"
echo "  Passed: ${PASSED}/16"
echo "  Failed: ${FAILED}/16"
echo "============================================"
