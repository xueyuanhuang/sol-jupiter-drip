
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

export function deriveKeypair(mnemonic: string): Keypair {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const path = `m/44'/501'/0'/0'`;
    const derived = derivePath(path, seed.toString('hex'));
    return Keypair.fromSeed(Buffer.from(derived.key));
}

export async function getBalance(connection: Connection, pubkey: PublicKey): Promise<bigint> {
    const bal = await connection.getBalance(pubkey, 'confirmed');
    return BigInt(bal);
}

export async function getTokenBalance(connection: Connection, owner: PublicKey, mint: string): Promise<{ amount: bigint, decimals: number }> {
    const mintPubkey = new PublicKey(mint);

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
    } catch (e) {
        console.error('[WALLET] Failed to get token balance', e);
        return { amount: 0n, decimals: 6 };
    }
}

// Unified helper for trading: handle SOL vs SPL
// For SOL, we want usable balance (native - fees)
export async function getSwapTokenBalance(connection: Connection, owner: PublicKey, mint: string): Promise<bigint> {
    const WSOL_MINT = 'So11111111111111111111111111111111111111112';

    if (mint === WSOL_MINT) {
        const bal = await getBalance(connection, owner);
        // Leave 0.01 SOL for fees
        const buffer = 10_000_000n;
        const usable = bal - buffer;
        return usable > 0n ? usable : 0n;
    } else {
        const bal = await getTokenBalance(connection, owner, mint);
        return bal.amount;
    }
}
