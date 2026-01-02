
import { Connection } from '@solana/web3.js';
import { loadConfig } from './config';
import { MultiRouteDrip } from './drip';
import { deriveKeypair } from './wallet';
import * as jupiter from './jupiter';

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'drip';

    console.log(`[CLI] Starting Sol-Jupiter-Drip (TypeScript) - Command: ${command}`);

    if (command === 'drip') {
        try {
            // Load config first
            const config = loadConfig();

            // Init network
            jupiter.initNetwork();

            console.log(`[CLI] Using RPC: ${config.rpcUrl}`);
            const connection = new Connection(config.rpcUrl, 'confirmed');
            const keypair = deriveKeypair(config.mnemonic);

            const bot = new MultiRouteDrip(connection, keypair, config);
            await bot.run();
        } catch (e: any) {
            console.error('[CLI] Error:', e.message);
            process.exit(1);
        }
    } else {
        console.log('Usage: ts-node src/index.ts drip');
        console.log('For legacy modes (SOL_TO_USDC, etc), use: node mvp-swap.js');
    }
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
