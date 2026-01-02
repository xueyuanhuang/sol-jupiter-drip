
export interface Route {
  name: string;      // e.g. "SOL-USDC"
  tokenMint: string; // The volatile token
  usdcMint: string;  // The stable token (USDC)
}

export interface DripConfig {
  routes: Route[];
  totalTrades: number;
  windowSec: number;
  usdcMin: number;
  usdcMax: number;
  dryRun: boolean;
  minDelaySec: number;
  failBackoffSec: number;
  rpcUrl: string;
  mnemonic: string;
  jupApiKey?: string;
  maxBuyRetries: number;
  maxSellRetries: number;
}

export enum CycleState {
  INIT = 'INIT',     // Ready to start a new round trip
  BOUGHT = 'BOUGHT', // Bought token, need to sell
  SOLD = 'SOLD'      // Sold token, cycle complete (transient state before next INIT?)
}

// Persisted state structure
export interface DripState {
  version: number;
  completedTrades: number; // Increment by 1 for each leg
  startTime: number;

  // Current Cycle State
  currentCycleId: string;
  cycleState: CycleState;

  // Active Route Info (persisted so we know what to sell if we crash)
  currentRouteName: string | null;
  currentRouteTokenMint: string | null;

  // Amount brought in buy leg, to track for selling? 
  // Requirement: "Sell leg must be executed until USDC is recovered" 
  // or just sell all token balance. 
  // Storing the "bought details" is good for logging/debugging.
  lastBuyTx: string | null;
  lastBuyTime: number | null;
  lastBuyAmount: string | null; // Token amount bought (raw units), used for Sell leg reference
}
