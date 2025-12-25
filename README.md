# Sol Jupiter DRIP

## 0. Quick Start (For first-time users)
Follow these steps to get running in 10 minutes:

1. **Check Node.js Version**
   Open your terminal and type:
   ```bash
   node -v
   ```
   If it's not installed or not `v20.x`, install it using nvm:
   ```bash
   nvm install 20
   nvm use 20
   ```

2. **Install Dependencies**
   Run this command in the project folder:
   ```bash
   npm install
   ```

3. **Configure Secrets**
   Copy the template config file:
   ```bash
   cp .env.example .env
   ```
   Open `.env` with any text editor and fill in your:
   - `MNEMONIC`: Your 24-word seed phrase (keep this safe!)
   - `JUP_API_KEY`: Get one from [jup.ag](https://jup.ag)

4. **Run DRIP**
   Start the bot:
   ```bash
   npm run start -- drip
   ```

---

## A. What this does
- Runs scheduled swaps for 1 hour with up to 150 trades, alternating `SOL↔USDC`, each trade targeting 2–3 USDC equivalent.

## B. Prerequisites
- Node.js `>=20` (LTS recommended)
  - *Tested on Node.js v20.x. Older or experimental versions (v18/v22/v23) may hang on macOS.*
- `npm` or `pnpm` (choose one)
- A reachable Solana RPC endpoint, e.g. `https://api.mainnet-beta.solana.com`
- A valid Jupiter `x-api-key`

## C. Setup
- Copy the example env and fill in your values:
  - `cp .env.example .env`
  - *.env is a local configuration file for your secrets. Never commit this file to Git!*
- Edit `.env`:
  - Provide your 24-word mnemonic (`SOLANA_MNEMONIC` or `MNEMONIC`)
  - Provide your `JUP_API_KEY`
  - Keep `RPC_URL` as default or point to your own RPC
  - Optionally set `PROXY_URL` if you use an HTTP proxy
  - Optionally configure Telegram notifications (see Section I)
- Do not paste real keys/mnemonics into README or commit them.

## D. Run modes
- Single swap modes:
  - `SOL_TO_USDC` — swap a small amount of SOL to USDC
  - `USDC_TO_SOL` — swap a small amount of USDC to SOL
  - `tg-test` — send a test notification to Telegram
- DRIP mode:
  - `drip` — scheduled small swaps over a time window with alternating directions
  - `multi-drip` — runs DRIP strategy for multiple wallets in parallel (see Section L)
  - `DRIP_DRY_RUN=true` — dry-run only quotes, does not send transactions
- Log levels:
  - `LOG_LEVEL=info` — concise output (default)
  - `LOG_LEVEL=debug` — prints HTTP request/response details and full quote JSON; `swapTransaction` body is truncated

## E. Examples
- Single SOL→USDC:
  - `npm run start -- SOL_TO_USDC`
- Single USDC→SOL:
  - `npm run start -- USDC_TO_SOL`
- DRIP default 150 trades / 1 hour:
  - `npm run start -- drip`
- Multi-wallet DRIP:
  - `npm run start -- multi-drip`
- DRIP 10 trades / 5 minutes (test):
  - `DRIP_TRADES=10 DRIP_WINDOW_SEC=300 npm run start -- drip`
- Dry-run only (no transaction sending):
  - `DRIP_DRY_RUN=true npm run start -- drip`
- Enable debug logs:
  - `LOG_LEVEL=debug npm run start -- drip`
- Test Telegram notification:
  - `npm run start -- tg-test`

## F. Output explained
Below is a sample (fake data) showing typical lines:
```
[DRIP 12/150] dir=SOL_TO_USDC target=2.34 USDC delay=23.1s
Quote: in=0.018762451 out=2.34
Sig: 4xYh9r3e... | Confirm: confirmed in 1423ms
Delta: SOL -0.019012451 | USDC +2.34
Result: SOL -> USDC (SOL delta includes fees)
```
- `dir`: Trade direction for this iteration.
- `target`: Chosen USDC amount for this trade (2–3 range).
- `delay`: Scheduled delay before executing this trade.
- `Quote: in/out`:
  - `in` — the input amount in UI units; for `SOL→USDC` this is SOL (lamports converted to SOL, 1e9), for `USDC→SOL` this is USDC (decimals 1e6).
  - `out` — the expected output amount in UI units; for `SOL→USDC` this is USDC, for `USDC→SOL` this is SOL.
- `Sig`: The transaction signature. You can search it on solana explorers such as Solscan or Solana Explorer.
- `Confirm`: Polling confirmation status and time spent (HTTP only, no WebSocket).
- `Delta`: Balance deltas after the trade. `SOL delta includes fees` because network fees are paid in SOL.
- `Result`: Inferred direction from the deltas; increase in USDC with decrease in SOL implies `SOL -> USDC`, and vice versa.

Single-swap mode has similar lines:
```
Before: SOL balance = 0.123456789 | USDC balance = 12.345678
Quote: inAmount = 0.010000000 | outAmount = 2.11
Transaction signature: 5cAbcdEf...xyz
After: SOL balance = 0.113333333 | USDC balance = 14.455678
Delta: SOL = -0.010123456 | USDC = +2.11
Result: SOL -> USDC (SOL delta includes fees)
```

## G. Safety notes
- Never print or commit your mnemonic or API key.
- Start with very small amounts to validate endpoints and behavior.
- If balances are insufficient, the trade is skipped (configurable via `DRIP_SKIP_IF_INSUFFICIENT`).
- Use `DRIP_DRY_RUN=true` for fast scheduling validation without sending transactions.

## H. Troubleshooting
- **New User Checklist (Program hangs or no output):**
  1. Check Node version: `node -v` (must be v20.x).
  2. Check dependencies: Did you run `npm install`?
  3. Check config: Does `.env` exist and have content?

- 401 Unauthorized (Jupiter):
  - Ensure `JUP_API_KEY` is set and correct; verify case and no trailing spaces.
- DNS resolution issues:
  - Check your network DNS, try a different resolver, or use a proxy via `PROXY_URL`.
- RPC timeout / request failures:
  - Verify `RPC_URL` is reachable. Public mainnet RPC is `https://api.mainnet-beta.solana.com` (operated by Triton One in multiple regions). Consider retrying or switching endpoints.
- Insufficient balance:
  - `SOL→USDC` requires SOL input plus a small SOL fee buffer (default ~0.002 SOL). `USDC→SOL` requires enough USDC plus a small buffer.
- Exceeded Compute Units (CU):
  - The code simulates and can re-quote excluding certain AMMs or using direct routes. Retry or adjust slippage/routes.
- Slippage too strict:
  - Increase `SLIPPAGE_BPS` if quotes fail under volatile conditions (current default is 50 bps).
- Confirmation timeout:
  - Network congestion can delay confirmations. The code polls via `getSignatureStatuses`. Retry, increase timeout, or reduce load.
- Multi-wallet RPC Rate Limits:
  - Running `multi-drip` with many wallets increases RPC usage significantly. If you see `429 Too Many Requests`, reduce concurrency or upgrade to a paid RPC provider.
- Proxy misconfiguration:
  - If using `PROXY_URL`, ensure it is reachable and correct protocol (e.g., `http://127.0.0.1:7890`). You can disable proxy by removing the variable.
- Local macOS (Node.js) Hangs:
  - If execution hangs immediately at `require("@solana/web3.js")` (no logs), it's a known compatibility issue with older Node versions on macOS.
  - **Solution**:
    1. Switch to Node.js v20 LTS.
    2. Clean reinstall dependencies: `rm -rf node_modules package-lock.json && npm install`.

## I. Telegram Notifications
To receive a summary after each DRIP run (or interruption), configure the following in `.env`:
- `TG_BOT_TOKEN`: Your Telegram Bot Token (from @BotFather).
- `TG_CHAT_ID`: Your Chat ID (you can get this from various bots like @userinfobot).
- `TG_ENABLED`: Set to `true` (default) to enable.
- `TG_TIMEOUT_MS`: Timeout for TG requests in ms (default `10000`).
- `TG_MAX_RETRY`: Max retries for TG requests (default `3`).
- `TG_SINGLE_SWAP`: Set to `true` to also receive notifications for single swaps (default `false`).

The summary includes start/end balances, net change, stats, and estimated value. It uses `Asia/Tokyo` time for the timestamp.

## J. Cloud Deployment (Ubuntu/Debian)
1. **Install Node.js (LTS)**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v # Should be >= v18
   ```

2. **Clone & Install**
   ```bash
   git clone https://github.com/your-repo/Sol-jupiter-drip.git
   cd Sol-jupiter-drip
   npm ci
   ```

3. **Configuration**
   ```bash
   cp .env.example .env
   nano .env
   # Fill in MNEMONIC, JUP_API_KEY, and TG_BOT_TOKEN
   ```

4. **Verify Manual Run**
   ```bash
   npm run start -- drip
   # Check if TG notification arrives
   ```

## K. Automation (Cron)
To run automatically every day at 21:00 (UTC+8):

1. **Set Timezone**
   ```bash
   sudo timedatectl set-timezone Asia/Shanghai
   date # Verify it shows CST
   ```

2. **Setup Cron**
   ```bash
   crontab -e
   ```
   Add the line (adjust path):
   ```cron
   0 21 * * * /home/ubuntu/Sol-jupiter-drip/scripts/run_daily_drip.sh
   ```

3. **Operations**
   - **Logs**: stored in `logs/drip_YYYY-MM-DD_...log`
   - **State**: `data/state.json` tracks last run stats
   - **Summary Log**: `logs/summary_YYYY-MM-DD.log` contains daily summaries

## L. Multi-wallet configuration
*Note: Most users only need the single-wallet mode (`npm run start -- drip`) using `MNEMONIC`. Only use this section if you explicitly need to run multiple wallets concurrently.*

To run DRIP on multiple wallets simultaneously in the same process:

1. **Configure Wallets (.env)**
   Add numbered variables for each additional wallet:
   ```env
   # Default wallet (required for single mode)
   MNEMONIC=...

   # Additional wallets for multi-drip mode
   WALLET_1_MNEMONIC=...
   WALLET_2_MNEMONIC=...
   # ...
   ```

2. **Run Command**
   ```bash
   npm run start -- multi-drip
   ```

3. **State Isolation**
   Each wallet maintains its own state file in `data/`:
   - `data/state_w1.json` (for WALLET_1)
   - `data/state_w2.json` (for WALLET_2)
   - `data/state.json` (for the default single run, if used separately)

   This ensures that failures or restarts in one wallet do not corrupt the state of others.

---

## Quick Reference
- Setup: `cp .env.example .env` and fill values
- Run single swap: `npm run start -- SOL_TO_USDC`
- Run DRIP: `npm run start -- drip`
- Dry run: `DRIP_DRY_RUN=true npm run start -- drip`
- Debug logs: `LOG_LEVEL=debug npm run start -- drip`
