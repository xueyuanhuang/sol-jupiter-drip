"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_DECIMALS = void 0;
exports.getDecimals = getDecimals;
exports.toUiAmount = toUiAmount;
exports.toRawAmount = toRawAmount;
exports.sleep = sleep;
exports.KNOWN_DECIMALS = {
    'So11111111111111111111111111111111111111112': 9, // WSOL/SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6, // USDC
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 6, // JUP
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 9, // WIF
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 5 // BONK
};
function getDecimals(mint) {
    return exports.KNOWN_DECIMALS[mint] || 6; // Default to 6 if unknown
}
function toUiAmount(raw, decimals) {
    const rawBig = typeof raw === 'string' ? BigInt(raw) : raw;
    // Using simple division for UI display (precision might be slightly lost for very large/small numbers but fine for logs)
    // For strict precision we'd use a BigNumber lib, but number is usually fine for logs of these magnitudes.
    return Number(rawBig) / Math.pow(10, decimals);
}
function toRawAmount(ui, decimals) {
    return BigInt(Math.round(ui * Math.pow(10, decimals)));
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
