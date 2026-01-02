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
const web3_js_1 = require("@solana/web3.js");
const config_1 = require("./config");
const drip_1 = require("./drip");
const wallet_1 = require("./wallet");
const jupiter = __importStar(require("./jupiter"));
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'drip';
    console.log(`[CLI] Starting Sol-Jupiter-Drip (TypeScript) - Command: ${command}`);
    if (command === 'drip') {
        try {
            // Load config first
            const config = (0, config_1.loadConfig)();
            // Init network
            jupiter.initNetwork();
            console.log(`[CLI] Using RPC: ${config.rpcUrl}`);
            const connection = new web3_js_1.Connection(config.rpcUrl, 'confirmed');
            const keypair = (0, wallet_1.deriveKeypair)(config.mnemonic);
            const bot = new drip_1.MultiRouteDrip(connection, keypair, config);
            await bot.run();
        }
        catch (e) {
            console.error('[CLI] Error:', e.message);
            process.exit(1);
        }
    }
    else {
        console.log('Usage: ts-node src/index.ts drip');
        console.log('For legacy modes (SOL_TO_USDC, etc), use: node mvp-swap.js');
    }
}
main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
