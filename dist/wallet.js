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
exports.deriveKeypair = deriveKeypair;
exports.getBalance = getBalance;
exports.getTokenBalance = getTokenBalance;
exports.getSwapTokenBalance = getSwapTokenBalance;
const web3_js_1 = require("@solana/web3.js");
const bip39 = __importStar(require("bip39"));
const ed25519_hd_key_1 = require("ed25519-hd-key");
function deriveKeypair(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const path = `m/44'/501'/0'/0'`;
    const derived = (0, ed25519_hd_key_1.derivePath)(path, seed.toString('hex'));
    return web3_js_1.Keypair.fromSeed(Buffer.from(derived.key));
}
async function getBalance(connection, pubkey) {
    const bal = await connection.getBalance(pubkey, 'confirmed');
    return BigInt(bal);
}
async function getTokenBalance(connection, owner, mint) {
    const mintPubkey = new web3_js_1.PublicKey(mint);
    // Helper to find ATA
    // We'll use getParsedTokenAccountsByOwner which is heavier but gives decimals, 
    // OR just use getTokenAccountsByOwner + getTokenAccountBalance. 
    // Existing code used getTokenAccountsByOwner then getTokenAccountBalance.
    try {
        const resp = await connection.getTokenAccountsByOwner(owner, { mint: mintPubkey }, 'confirmed');
        if (resp.value.length === 0) {
            return { amount: 0n, decimals: 6 }; // Default to 6 if unknown, but amount 0 matters most
        }
        const ata = resp.value[0].pubkey;
        const bal = await connection.getTokenAccountBalance(ata, 'confirmed');
        return {
            amount: BigInt(bal.value.amount),
            decimals: bal.value.decimals
        };
    }
    catch (e) {
        console.error('[WALLET] Failed to get token balance', e);
        return { amount: 0n, decimals: 6 };
    }
}
// Unified helper for trading: handle SOL vs SPL
// For SOL, we want usable balance (native - fees)
async function getSwapTokenBalance(connection, owner, mint) {
    const WSOL_MINT = 'So11111111111111111111111111111111111111112';
    if (mint === WSOL_MINT) {
        const bal = await getBalance(connection, owner);
        // Leave 0.01 SOL for fees
        const buffer = 10000000n;
        const usable = bal - buffer;
        return usable > 0n ? usable : 0n;
    }
    else {
        const bal = await getTokenBalance(connection, owner, mint);
        return bal.amount;
    }
}
