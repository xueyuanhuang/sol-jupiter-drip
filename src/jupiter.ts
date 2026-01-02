
import { Connection, Keypair, VersionedTransaction, TransactionSignature } from '@solana/web3.js';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

// Proxy setup
export function initNetwork() {
    const PROXY_URL = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (PROXY_URL) {
        try {
            const agent = new ProxyAgent(PROXY_URL);
            setGlobalDispatcher(agent);
            console.log(`[NET] Proxy enabled: ${new URL(PROXY_URL).host}`);
        } catch (e) {
            console.error('[NET] Failed to set proxy', e);
        }
    }
}

export async function getQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
    slippageBps: number,
    apiKey?: string,
    excludeDexes?: string[],
    onlyDirectRoutes?: boolean
): Promise<any> {
    const url = new URL('https://api.jup.ag/swap/v1/quote');
    url.searchParams.set('inputMint', inputMint);
    url.searchParams.set('outputMint', outputMint);
    url.searchParams.set('amount', amount.toString());
    url.searchParams.set('slippageBps', slippageBps.toString());
    if (excludeDexes?.length) url.searchParams.set('excludeDexes', excludeDexes.join(','));
    if (onlyDirectRoutes) url.searchParams.set('onlyDirectRoutes', 'true');

    const headers: Record<string, string> = {};
    if (apiKey) headers['x-api-key'] = apiKey;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
        throw new Error(`Quote failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
}

export async function getSwapTransaction(
    quoteResponse: any,
    userPublicKey: string,
    apiKey?: string
): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;

    const body = {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true
    };

    const res = await fetch('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        throw new Error(`Swap API failed: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    return json.swapTransaction;
}

export async function executeSwap(
    connection: Connection,
    keypair: Keypair,
    swapTransactionBase64: string
): Promise<string> {
    const txBuf = Buffer.from(swapTransactionBase64, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([keypair]);

    const raw = tx.serialize();
    const sig = await connection.sendRawTransaction(raw, {
        skipPreflight: true, // We rely on polling/sim, or standard retry
        maxRetries: 2
    });
    return sig;
}

export async function confirmTransaction(
    connection: Connection,
    signature: string,
    timeoutMs: number = 60000
): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const { value } = await connection.getSignatureStatuses([signature]);
        const status = value[0];
        if (status) {
            if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
            if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
                return true;
            }
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('Confirmation timeout');
}
