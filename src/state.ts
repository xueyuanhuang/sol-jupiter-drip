
import * as fs from 'fs';
import * as path from 'path';
import { DripState, CycleState } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state_v2.json');

export function loadState(): DripState {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(STATE_FILE)) {
        try {
            const content = fs.readFileSync(STATE_FILE, 'utf-8');
            const data = JSON.parse(content);
            // Basic validation
            if (data.version === 2) {
                // RECOVERY CHECK:
                // Only load state if we are in BOUGHT state (crash recovery).
                // Otherwise, start fresh (completedTrades=0).
                if (data.cycleState === CycleState.BOUGHT) {
                    return {
                        ...data,
                        completedTrades: 0, // Reset counters for new run
                        startTime: Date.now() // Reset timer
                    };
                }
            }
        } catch (e) {
            console.warn('[STATE] Failed to load existing state, starting fresh.', e);
        }
    }

    return {
        version: 2,
        completedTrades: 0,
        startTime: Date.now(),
        currentCycleId: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        cycleState: CycleState.INIT,
        currentRouteName: null,
        currentRouteTokenMint: null,
        lastBuyTx: null,
        lastBuyTime: null,
        lastBuyAmount: null
    };
}

export function saveState(state: DripState) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
