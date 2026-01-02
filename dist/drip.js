"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiRouteDrip = void 0;
const types_1 = require("./types");
const jupiter = __importStar(require("./jupiter"));
const wallet = __importStar(require("./wallet"));
const scheduler = __importStar(require("./scheduler"));
const stateMgr = __importStar(require("./state"));
const utils = __importStar(require("./utils"));
const stats_1 = require("./stats");
const IS_DEBUG = (process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
function logInfo(msg) {
    console.log(msg);
}
function logDebug(msg) {
    if (IS_DEBUG)
        console.log(msg);
}
class MultiRouteDrip {
    constructor(connection, keypair, config) {
        // --- Helper for Summary ---
        this.startBalances = { usdc: 0, sol: 0, price: 0 };
        this.connection = connection;
        this.keypair = keypair;
        this.config = config;
        this.state = stateMgr.loadState();
        this.stats = new stats_1.StatsCollector();
    }
    async run() {
        logInfo('[RUN] Starting Multi-Route Round-Trip Strategy');
        try {
            // --- RECOVERY PHASE ---
            if (this.state.cycleState === types_1.CycleState.BOUGHT) {
                logInfo('[STATE] Recovery state found: YES. Unwinding previous incomplete cycle...');
                await this.retryLeg(() => this.executeSell(true), this.config.maxSellRetries, 'SELL (Recovery)');
                logInfo('[STATE] Recovery state cleared.');
                // Force a clean state for the NEW run
                this.state = stateMgr.loadState();
                this.state = {
                    ...this.state,
                    cycleState: types_1.CycleState.INIT,
                    completedTrades: 0,
                    startTime: Date.now(),
                    lastBuyAmount: null
                };
                stateMgr.saveState(this.state);
            }
            else {
                logDebug('[STATE] Recovery state found: NO');
            }
            // --- NEW RUN ---
            const uniqueRoutes = this.config.routes.length;
            logInfo(`[RUN] mode=multi_route target=${this.config.totalTrades} legs window=${this.config.windowSec}s routes=${uniqueRoutes}`);
            this.captureStartBalances();
            while (this.state.completedTrades < this.config.totalTrades) {
                // 1. Calculate Delay
                const delayMs = scheduler.calculateDelay(this.config, this.state);
                if (delayMs > 0) {
                    logDebug(`[scheduler] Waiting ${(delayMs / 1000).toFixed(1)}s...`);
                    await utils.sleep(delayMs);
                }
                // 2. Logic based on state
                try {
                    if (this.state.cycleState === types_1.CycleState.INIT || this.state.cycleState === types_1.CycleState.SOLD) {
                        if (this.state.cycleState === types_1.CycleState.SOLD) {
                            this.state.cycleState = types_1.CycleState.INIT;
                            stateMgr.saveState(this.state);
                        }
                        await this.retryLeg(() => this.executeBuy(), this.config.maxBuyRetries, 'BUY');
                    }
                    else if (this.state.cycleState === types_1.CycleState.BOUGHT) {
                        await this.retryLeg(() => this.executeSell(false), this.config.maxSellRetries, 'SELL');
                    }
                }
                catch (err) {
                    console.error(`[FATAL] ${err.message}`);
                    console.error('[ABORT] Run halted due to persistent failures.');
                    throw err;
                }
                stateMgr.saveState(this.state);
            }
            console.log('[DRIP] Work Complete!');
        }
        catch (e) {
            console.error(`[RUN] Aborted: ${e.message}`);
        }
        finally {
            await this.printEndSummary();
        }
    }
    async retryLeg(action, maxRetries, legName) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await action();
                return; // Success
            }
            catch (err) {
                lastError = err;
                // Log level gating for retry noise
                if (IS_DEBUG) {
                    console.error(`[${legName}] Attempt ${i + 1}/${maxRetries} failed: ${err.message}`);
                }
                else if (i === maxRetries - 1) {
                    // Only print concise warning on final fail (which will throw below)
                    // Or maybe print "Retrying..." only if DEBUG?
                    // "Only show one concise warning if retries happen, and only if the request ultimately fails"
                    // So we stay silent on interim failures in INFO mode?
                    // User says: "Do NOT print per-retry backoff lines."
                }
                if (i < maxRetries - 1) {
                    const backoff = this.config.failBackoffSec * 1000;
                    if (IS_DEBUG)
                        logDebug(`[${legName}] Retrying in ${this.config.failBackoffSec}s...`);
                    await utils.sleep(backoff);
                }
            }
        }
        throw new Error(`Exhausted ${maxRetries} retries for ${legName}: ${lastError?.message}`);
    }
    async executeBuy() {
        const legIdx = this.state.completedTrades + 1;
        const total = this.config.totalTrades;
        const route = this.pickRandomRoute();
        // Amount
        const usdcAmt = this.randomFloat(this.config.usdcMin, this.config.usdcMax);
        const amountIn = utils.toRawAmount(usdcAmt, 6); // USDC is 6 decimals
        const startTime = Date.now();
        let sig = 'dry_run';
        let boughtAmountRaw = '0';
        let tokenAmountOutUi = 0;
        // Decimals for the token we are buying
        const tokenDecimals = utils.getDecimals(route.tokenMint);
        if (this.config.dryRun) {
            logDebug(`[DRIP] Dry Run: Quote only ${route.name}`);
            const q = await jupiter.getQuote(route.usdcMint, route.tokenMint, amountIn, 50, this.config.jupApiKey);
            boughtAmountRaw = q.outAmount;
            tokenAmountOutUi = utils.toUiAmount(BigInt(boughtAmountRaw), tokenDecimals);
            await utils.sleep(500);
            this.updateStateAfterBuy(route, 'dry_run', boughtAmountRaw);
        }
        else {
            const quote = await jupiter.getQuote(route.usdcMint, route.tokenMint, amountIn, 100, this.config.jupApiKey);
            const txBase64 = await jupiter.getSwapTransaction(quote, this.keypair.publicKey.toBase58(), this.config.jupApiKey);
            sig = await jupiter.executeSwap(this.connection, this.keypair, txBase64);
            await jupiter.confirmTransaction(this.connection, sig);
            boughtAmountRaw = quote.outAmount;
            tokenAmountOutUi = utils.toUiAmount(BigInt(boughtAmountRaw), tokenDecimals);
            this.updateStateAfterBuy(route, sig, boughtAmountRaw);
        }
        // Safety check for logging / amount sanity
        if (route.name.includes('SOL') && tokenAmountOutUi > 0.05 && usdcAmt < 1) {
            // "For SOL-USDC BUY, if token_out_ui > 0.05 SOL while usdc_in < 1 USDC, flag..."
            console.error(`[SAFETY] SUSPICIOUS AMOUNT: Bought ${tokenAmountOutUi} SOL for only ${usdcAmt} USDC? Decimals likely wrong.`);
            // Must abort
            throw new Error('Safety: Suspicious buy amount/decimals match.');
        }
        logInfo(`[LEG ${legIdx}/${total}] BUY route=${route.name} usdc_in=${usdcAmt.toFixed(4)} token_out=${tokenAmountOutUi.toFixed(tokenDecimals === 9 ? 6 : 4)}`);
        const duration = (Date.now() - startTime) / 1000;
        this.stats.recordLeg(route.name, 'BUY', usdcAmt, sig, duration * 1000);
    }
    async executeSell(isRecovery) {
        let legIdx = this.state.completedTrades + 1;
        const routeName = this.state.currentRouteName;
        const tokenMint = this.state.currentRouteTokenMint;
        if (!routeName || !tokenMint)
            throw new Error('State corrupted: No route info for SELL.');
        const route = this.config.routes.find(r => r.tokenMint === tokenMint);
        const usdcMint = route ? route.usdcMint : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        // --- STRICT SELL AMOUNT LOGIC ---
        // Must use lastBuyAmount (per-cycle)
        if (!this.state.lastBuyAmount) {
            // If we don't have it (maybe old state or manual?), we must be careful.
            // If recovery, maybe safer to sell all?
            // But strict requirement says: "SELL amount must be per-cycle (NEVER full wallet balance)"
            // If we lost state, we should probably ERROR or sell a safe small default if dry run?
            // For now, fail safe.
            throw new Error('[SAFETY] Missing lastBuyAmount in state. Cannot execute safe per-cycle sell.');
        }
        const targetSellAmount = BigInt(this.state.lastBuyAmount);
        let amountToSell = targetSellAmount;
        if (!this.config.dryRun) {
            // Real run: Validate with balance
            const walletBal = await wallet.getSwapTokenBalance(this.connection, this.keypair.publicKey, tokenMint);
            if (walletBal < targetSellAmount) {
                // We have LESS than we bought? (Fees, transfer, dust diff?)
                // Allow small diff? "If walletBalance is very close (99%), sell walletBalance."
                const diff = Number(targetSellAmount - walletBal) / Number(targetSellAmount);
                if (diff < 0.02) { // < 2% missing
                    logDebug(`[SAFETY] Wallet balance slightly lower (${walletBal} < ${targetSellAmount}). Selling full balance.`);
                    amountToSell = walletBal;
                }
                else {
                    throw new Error(`[SAFETY] Wallet balance (${walletBal}) significantly lower than bought amount (${targetSellAmount}). Aborting to avoid unexpected behavior.`);
                }
            }
            else if (walletBal > targetSellAmount) {
                // We have MORE than we bought.
                // Strict rule: "Sell only that amount (SOL wallet does not drop by 0.2 SOL)"
                // Check if targetSellAmount is reasonable? 
                // "If sellAmountRaw > cycle.buyTokenRaw * 1.02 then ABORT"
                // Here amountToSell IS targetSellAmount (lastBuy), so it satisfies equality.
                // We just proceed to sell amountToSell, IGNORING extra balance.
                logDebug(`[SAFETY] Selling cycle amount ${amountToSell} (Wallet holds ${walletBal}).`);
            }
            if (amountToSell === 0n) {
                throw new Error(`[SELL] CRITICAL: Balance is 0. Cannot sell.`);
            }
        }
        else {
            // Dry run
            amountToSell = targetSellAmount;
        }
        const tokenDecimals = utils.getDecimals(tokenMint);
        const startTime = Date.now();
        let sig = 'dry_run';
        let usdcOutUi = 0;
        if (this.config.dryRun) {
            logDebug(`[DRIP] Dry Run: Selling ${routeName}`);
            const q = await jupiter.getQuote(tokenMint, usdcMint, amountToSell, 50, this.config.jupApiKey);
            usdcOutUi = utils.toUiAmount(q.outAmount, 6);
            await utils.sleep(500);
            this.updateStateAfterSell();
        }
        else {
            console.log(`[SELL] Selling ${utils.toUiAmount(amountToSell, tokenDecimals)} units of ${routeName}...`);
            const quote = await jupiter.getQuote(tokenMint, usdcMint, amountToSell, 100, this.config.jupApiKey);
            usdcOutUi = utils.toUiAmount(quote.outAmount, 6);
            const txBase64 = await jupiter.getSwapTransaction(quote, this.keypair.publicKey.toBase58(), this.config.jupApiKey);
            sig = await jupiter.executeSwap(this.connection, this.keypair, txBase64);
            await jupiter.confirmTransaction(this.connection, sig);
            this.updateStateAfterSell();
        }
        const tokenInUi = utils.toUiAmount(amountToSell, tokenDecimals);
        if (isRecovery) {
            logInfo(`[RECOVERY] SELL route=${routeName} token_in=${tokenInUi.toFixed(6)} usdc_out=${usdcOutUi.toFixed(4)}`);
        }
        else {
            logInfo(`[LEG ${legIdx}/${this.config.totalTrades}] SELL route=${routeName} token_in=${tokenInUi.toFixed(6)} usdc_out=${usdcOutUi.toFixed(4)}`);
            const duration = (Date.now() - startTime) / 1000;
            this.stats.recordLeg(routeName, 'SELL', usdcOutUi, sig, duration * 1000);
        }
    }
    pickRandomRoute() {
        const idx = Math.floor(Math.random() * this.config.routes.length);
        return this.config.routes[idx];
    }
    randomFloat(min, max) {
        return Math.random() * (max - min) + min;
    }
    updateStateAfterBuy(route, tx, amountRaw) {
        this.state.cycleState = types_1.CycleState.BOUGHT;
        this.state.currentRouteName = route.name;
        this.state.currentRouteTokenMint = route.tokenMint;
        this.state.lastBuyTx = tx;
        this.state.lastBuyTime = Date.now();
        this.state.lastBuyAmount = amountRaw;
        this.state.completedTrades += 1;
        stateMgr.saveState(this.state);
    }
    updateStateAfterSell() {
        this.state.cycleState = types_1.CycleState.SOLD;
        this.state.completedTrades += 1;
        this.state.currentRouteName = null;
        this.state.currentRouteTokenMint = null;
        this.state.lastBuyAmount = null;
        stateMgr.saveState(this.state);
    }
    async captureStartBalances() {
        try {
            const solBal = await wallet.getBalance(this.connection, this.keypair.publicKey);
            this.startBalances.sol = Number(solBal) / 1e9;
            const usdcBal = await wallet.getTokenBalance(this.connection, this.keypair.publicKey, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            this.startBalances.usdc = Number(usdcBal.amount) / Math.pow(10, usdcBal.decimals);
            if (!this.config.dryRun) {
                try {
                    const q = await jupiter.getQuote('So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1000000000n, 50);
                    this.startBalances.price = Number(q.outAmount) / 1e6;
                }
                catch (e) {
                    this.startBalances.price = 0;
                }
            }
        }
        catch (e) {
            logDebug('[WARN] Failed to capture start balances');
        }
    }
    async printEndSummary() {
        let endUsdc = this.startBalances.usdc;
        let endSol = this.startBalances.sol;
        try {
            const solBal = await wallet.getBalance(this.connection, this.keypair.publicKey);
            endSol = Number(solBal) / 1e9;
            const usdcBal = await wallet.getTokenBalance(this.connection, this.keypair.publicKey, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            endUsdc = Number(usdcBal.amount) / Math.pow(10, usdcBal.decimals);
        }
        catch (e) { }
        const elapsed = (Date.now() - this.state.startTime) / 1000;
        logInfo(`[RUN] complete in ${elapsed.toFixed(1)}s`);
        this.stats.printSummary(this.config.totalTrades, this.config.windowSec, {
            startUsdc: this.startBalances.usdc,
            endUsdc,
            startSol: this.startBalances.sol,
            endSol,
            solPriceInUsdc: this.startBalances.price
        }, this.config.dryRun);
    }
}
exports.MultiRouteDrip = MultiRouteDrip;
