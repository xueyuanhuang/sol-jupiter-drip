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
exports.loadConfig = loadConfig;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const KNOWN_MINTS = {
    'SOL': 'So11111111111111111111111111111111111111112',
    'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    'TRUMP': '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', // Validating this might be risky, but used as fallback
    'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
};
function parseRoutes(envRoutes, envJson) {
    // 1. Try JSON first
    if (envJson) {
        try {
            const parsed = JSON.parse(envJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.map((r) => ({
                    name: r.name || 'Unknown-Pair',
                    tokenMint: r.tokenMint,
                    usdcMint: r.usdcMint || KNOWN_MINTS['USDC']
                }));
            }
        }
        catch (e) {
            console.warn('[CONFIG] Failed to parse DRIP_ROUTES_JSON, falling back to string list.');
        }
    }
    // 2. Fallback to string list
    if (!envRoutes)
        return [];
    const pairs = envRoutes.split(',').map(s => s.trim()).filter(Boolean);
    const routes = [];
    for (const pair of pairs) {
        // Expected format: "SOL-USDC" or "USDC-SOL"
        // Identify which is USDC and which is Token
        const parts = pair.split('-');
        if (parts.length !== 2) {
            console.warn(`[CONFIG] Invalid pair format: ${pair}. Skipping.`);
            continue;
        }
        const t1 = parts[0].toUpperCase();
        const t2 = parts[1].toUpperCase();
        let tokenSymbol = null;
        if (t1 === 'USDC' && t2 !== 'USDC') {
            tokenSymbol = t2;
        }
        else if (t2 === 'USDC' && t1 !== 'USDC') {
            tokenSymbol = t1;
        }
        else {
            console.warn(`[CONFIG] Pair ${pair} does not contain USDC or is invalid. Skipping.`);
            continue;
        }
        const mint = KNOWN_MINTS[tokenSymbol];
        if (!mint) {
            console.warn(`[CONFIG] Unknown mint for symbol ${tokenSymbol} in pair ${pair}. Please use DRIP_ROUTES_JSON.`);
            continue;
        }
        routes.push({
            name: pair,
            tokenMint: mint,
            usdcMint: KNOWN_MINTS['USDC']
        });
    }
    return routes;
}
function loadConfig() {
    const routes = parseRoutes(process.env.DRIP_ROUTES, process.env.DRIP_ROUTES_JSON);
    if (routes.length === 0 && process.env.DRIP_MODE === 'multi_route') {
        throw new Error('No valid routes found. Set DRIP_ROUTES or DRIP_ROUTES_JSON.');
    }
    return {
        routes,
        totalTrades: parseInt(process.env.DRIP_TARGET_TRADES || process.env.DRIP_TRADES || '10', 10),
        windowSec: parseInt(process.env.DRIP_WINDOW_SEC || '3600', 10),
        usdcMin: parseFloat(process.env.DRIP_USDC_MIN || '1'),
        usdcMax: parseFloat(process.env.DRIP_USDC_MAX || '2'),
        dryRun: process.env.DRIP_DRY_RUN === 'true',
        minDelaySec: parseInt(process.env.DRIP_MIN_DELAY_SEC || '5', 10),
        failBackoffSec: parseInt(process.env.DRIP_FAIL_BACKOFF_SEC || '30', 10),
        rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
        mnemonic: process.env.SOLANA_MNEMONIC || process.env.MNEMONIC || '',
        jupApiKey: process.env.JUP_API_KEY,
        maxBuyRetries: parseInt(process.env.DRIP_MAX_BUY_RETRIES || '3', 10),
        maxSellRetries: parseInt(process.env.DRIP_MAX_SELL_RETRIES || '5', 10)
    };
}
