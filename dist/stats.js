"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsCollector = void 0;
class StatsCollector {
    constructor() {
        this.routeStats = new Map();
        this.legs = [];
    }
    getRouteStats(route) {
        if (!this.routeStats.has(route)) {
            this.routeStats.set(route, {
                buyCount: 0,
                sellCount: 0,
                completedCycles: 0,
                usdcIn: 0,
                usdcOut: 0
            });
        }
        return this.routeStats.get(route);
    }
    recordLeg(route, side, usdcValue, signature, confirmMs) {
        const stats = this.getRouteStats(route);
        if (side === 'BUY') {
            stats.buyCount++;
            stats.usdcIn += usdcValue;
        }
        else {
            stats.sellCount++;
            stats.usdcOut += usdcValue;
            stats.completedCycles++;
        }
        this.legs.push({
            route, side, usdcValue, signature, confirmMs, timestamp: Date.now()
        });
    }
    printSummary(targetLegs, windowSec, balances, dryRun) {
        const uniqueRoutes = this.routeStats.size;
        const completedLegs = this.legs.length;
        console.log('\n=== SUMMARY (multi_route) ===');
        console.log(`Window: ${windowSec}s | Target: ${targetLegs} legs | Completed: ${completedLegs} legs | Routes: ${uniqueRoutes}`);
        console.log('\nPer-route:');
        let totalUsdcIn = 0;
        let totalUsdcOut = 0;
        this.routeStats.forEach((stats, route) => {
            const net = stats.usdcOut - stats.usdcIn;
            totalUsdcIn += stats.usdcIn;
            totalUsdcOut += stats.usdcOut;
            console.log(`- ${route}: cycles=${stats.completedCycles} (BUY=${stats.buyCount}, SELL=${stats.sellCount})  USDC_in=${stats.usdcIn.toFixed(4)}  USDC_out=${stats.usdcOut.toFixed(4)}  net=${net.toFixed(4)}`);
        });
        console.log('\nBalances:');
        const usdcDelta = balances.endUsdc - balances.startUsdc;
        const solDelta = balances.endSol - balances.startSol;
        console.log(`- USDC: ${balances.startUsdc.toFixed(4)} -> ${balances.endUsdc.toFixed(4)} (Δ ${usdcDelta.toFixed(4)})`);
        console.log(`- SOL:  ${balances.startSol.toFixed(6)} -> ${balances.endSol.toFixed(6)} (Δ ${solDelta.toFixed(6)} SOL)`);
        console.log('\nCosts:');
        if (dryRun) {
            console.log('- Net swap loss: N/A (dry-run)');
            console.log('- Network fees:  N/A (dry-run)');
            console.log('- Total estimated cost: N/A (dry-run)');
        }
        else {
            // Net swap from stats
            const swapNet = totalUsdcOut - totalUsdcIn; // Profit (Positive) or Loss (Negative)
            console.log(`- Net swap result: ${swapNet >= 0 ? '+' : ''}${swapNet.toFixed(4)} USDC`);
            // Fee is Cost (Absolute value of drop)
            // SOL fees are usually negative delta
            const solFee = balances.startSol - balances.endSol; // Expected positive if fees paid
            const solFeeStr = solFee >= 0 ? solFee.toFixed(6) : `(Gain? ${Math.abs(solFee).toFixed(6)})`;
            const solFeeUsdc = solFee * balances.solPriceInUsdc;
            const feeStr = balances.solPriceInUsdc > 0
                ? `(~$${solFeeUsdc.toFixed(4)} USDC)`
                : `(Price N/A)`;
            console.log(`- Network fees:  ${solFeeStr} SOL ${feeStr}`);
            // Total cost = (Swap Profit/Loss) - (Fees)
            // Actually usually we want "Net PnL"
            // Net PnL = SwapNet - Fees
            const netPnL = swapNet - solFeeUsdc;
            console.log(`- Total Net PnL:   ${netPnL >= 0 ? '+' : ''}${netPnL.toFixed(4)} USDC`);
        }
        console.log('=============================\n');
    }
}
exports.StatsCollector = StatsCollector;
