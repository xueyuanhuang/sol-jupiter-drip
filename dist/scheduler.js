"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDelay = calculateDelay;
const types_1 = require("./types");
function calculateDelay(config, state) {
    // If we are holding a token, we must sell immediately (no delay between legs)
    if (state.cycleState === types_1.CycleState.BOUGHT) {
        return 0;
    }
    // Calculate remaining work
    const now = Date.now();
    const deadline = state.startTime + (config.windowSec * 1000);
    const remainingTime = deadline - now;
    const remainingTrades = config.totalTrades - state.completedTrades;
    if (remainingTrades <= 0)
        return 0; // Done
    // Remaining cycles (round trips)
    // Each cycle is 2 trades. 
    // If remainingTrades is odd (e.g. 1 left, meaning we did 0.5 cycle?), treat as 1 cycle aka 0.5.
    // Actually, we enforce Round Trips. So remainingTrades should be even usually.
    const remainingCycles = Math.ceil(remainingTrades / 2);
    if (remainingTime <= 0) {
        console.warn('[SCHEDULER] Time window exceeded!');
        return 0; // ASAP
    }
    // Safety factor: aim to finish slightly early (e.g. use 85% of available time)
    const SAFETY_FACTOR = 0.85;
    // Time available per remaining cycle
    // We want to distribute delays.
    // availableDelayTotal = remainingTime - (ExpectedExecutionTime * remainingCycles)
    // But ExecutionTime is variable. Let's simplfy:
    // We can delay up to (remainingTime / remainingCycles) * SAFETY_FACTOR.
    // But we also need to account that execution takes time (maybe 30s-60s per cycle).
    const ESTIMATED_EXEC_MS = 45000; // 45s for Buy+Sell+Confirmations
    const safeTimeWindow = remainingTime - (ESTIMATED_EXEC_MS * remainingCycles);
    if (safeTimeWindow <= 0) {
        console.warn('[SCHEDULER] Behind schedule, 0 delay.');
        return 0;
    }
    const avgDelayAllocated = safeTimeWindow / remainingCycles;
    const maxDelay = avgDelayAllocated * SAFETY_FACTOR;
    const minDelay = config.minDelaySec * 1000;
    if (maxDelay < minDelay) {
        return 0; // Hurry up
    }
    // Randomized delay
    // We use a uniform distribution [min, max]
    // Ideally, if we consistently pick max, we might run out.
    // But we re-calculate every cycle, so it self-corrects. 
    // (If we waited long last time, remainingTime shrinks, maxDelay shrinks).
    const delay = Math.random() * (maxDelay - minDelay) + minDelay;
    return Math.floor(delay);
}
