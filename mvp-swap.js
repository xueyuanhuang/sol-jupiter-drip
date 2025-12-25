#!/usr/bin/env node
'use strict';

const { Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const dotenv = require('dotenv');
const { setGlobalDispatcher, ProxyAgent } = require('undici');
const fs = require('fs');
const path = require('path');

dotenv.config();

const { sendTelegram } = require('./notifier/telegram');

// TG Config
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const TG_ENABLED = process.env.TG_ENABLED !== 'false'; // default true
const TG_TIMEOUT_MS = parseInt(process.env.TG_TIMEOUT_MS || '10000', 10);
const TG_MAX_RETRY = parseInt(process.env.TG_MAX_RETRY || '3', 10);
const TG_SINGLE_SWAP = process.env.TG_SINGLE_SWAP === 'true';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
// Env precedence: prefer SOLANA_MNEMONIC; fallback to MNEMONIC for compatibility
const MNEMONIC = process.env.SOLANA_MNEMONIC || process.env.MNEMONIC || '';
const JUP_API_KEY = process.env.JUP_API_KEY || '';
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '10000', 10);

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const SLIPPAGE_BPS = 50;
const AMOUNT_SOL_TO_USDC_SOL = 0.01;
const AMOUNT_USDC_TO_SOL_USDC = 2;

let IS_PROXY_ENABLED = false;

// Logging strategy: info prints concise operational lines; debug prints full HTTP REQ/RES and quote JSON
const IS_DEBUG = (process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug';

function logDebug(msg) {
  if (IS_DEBUG) console.log(msg);
}

// --- Network Initialization ---

function initNetwork() {
  const proxyUrl = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      const agent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(agent);
      IS_PROXY_ENABLED = true;
      console.log(`[NET] Proxy enabled: ${u.host}`);
    } catch (err) {
      console.error(`[NET] Failed to set proxy: ${err.message}`);
    }
  } else {
    console.log('[NET] Proxy disabled');
  }
}

// --- Observability Helpers ---

function logError(context, err) {
  console.error(`[ERROR][${context}] ${err.name || 'Error'}: ${err.message}`);
  if (err.stack) {
    console.error(`Stack: ${err.stack}`);
  }
  
  // Recursive cause printing
  let cause = err.cause;
  let depth = 1;
  while (cause) {
    console.error(`[CAUSE:${depth}] ${cause.name || 'Error'}: ${cause.message}`);
    if (cause.stack) {
      console.error(`Stack: ${cause.stack}`);
    }
    // Print common fetch/undici error fields
    const fetchFields = ['code', 'errno', 'syscall', 'address', 'port'];
    const details = fetchFields
      .filter(f => cause[f] !== undefined)
      .map(f => `${f}=${cause[f]}`)
      .join(', ');
    if (details) {
      console.error(`Details: ${details}`);
    }
    cause = cause.cause;
    depth++;
  }
}

class FetchError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.body = body;
  }
}

// --- State & Logging Helpers ---

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveDripState(data, label = null) {
  try {
    ensureDir('data');
    const filename = label ? `state_${label}.json` : 'state.json';
    const file = path.join('data', filename);
    const content = {
      updatedAt: new Date().toISOString(),
      ...data
    };
    fs.writeFileSync(file, JSON.stringify(content, null, 2));
  } catch (err) {
    console.error(`[WARN] Failed to save state: ${err.message}`);
  }
}

function appendSummaryLog(text) {
  try {
    ensureDir('logs');
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const file = path.join('logs', `summary_${dateStr}.log`);
    fs.appendFileSync(file, text + '\n' + '-'.repeat(40) + '\n\n');
  } catch (err) {
    console.error(`[WARN] Failed to write log: ${err.message}`);
  }
}

async function fetchJson(url, options = {}, { label = 'fetch', timeout = FETCH_TIMEOUT_MS } = {}) {
  const method = options.method || 'GET';
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  // Clean headers for logging (hide sensitive keys if any)
  const logHeaders = { ...options.headers };
  // (Optional: redact Authorization if needed in future)

  logDebug(`[FETCH:REQ][${label}] ${method} ${url}`);
  if (IS_PROXY_ENABLED) {
    logDebug(`[FETCH:DEBUG] Proxy enabled for this request`);
  }
  if (Object.keys(logHeaders).length > 0) {
    // logDebug(`Headers: ${JSON.stringify(logHeaders)}`); // Uncomment if verbose needed
  }
  if (options.body) {
    const bodyStr = String(options.body);
    logDebug(`Body: ${bodyStr.slice(0, 500)}${bodyStr.length > 500 ? '...' : ''}`);
  }

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);

    logDebug(`[FETCH:RES][${label}] ${res.status} ${res.statusText}`);
    
    // Always read body for logging
    const text = await res.text();
    
    // Debug logging for body with special truncation for swapTransaction
    if (IS_DEBUG) {
      let displayBody = text;
      // Heuristic: if text looks like JSON and has "swapTransaction"
      if (text.includes('"swapTransaction"')) {
        try {
          const json = JSON.parse(text);
          if (json.swapTransaction && typeof json.swapTransaction === 'string') {
             const tx = json.swapTransaction;
             const truncated = tx.slice(0, 80) + `...[len=${tx.length}]`;
             const displayObj = { ...json, swapTransaction: truncated };
             displayBody = JSON.stringify(displayObj);
          }
        } catch (e) {
          // ignore parse error, just print raw text
        }
      }
      console.log(`Body: ${displayBody.slice(0, 1000)}${displayBody.length > 1000 ? '...' : ''}`);
    }

    if (!res.ok) {
      // Force detailed log on error if not already in debug mode
      if (!IS_DEBUG) {
        console.error(`[FETCH:ERR][${label}] ${method} ${url}`);
        if (options.body) console.error(`Req Body: ${String(options.body).slice(0, 1000)}`);
        console.error(`Res Status: ${res.status}`);
        console.error(`Res Body: ${text.slice(0, 2000)}`);
      }
      throw new FetchError(`Request failed with status ${res.status}`, res.status, text);
    }

    // Try parsing JSON if content-type says so, or just return text/json
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      console.error(`[FETCH:TIMEOUT][${label}] ${url} after ${timeout}ms`);
    }
    // If it's a network error (not a 4xx/5xx handled above) and not debug, log details
    if (!IS_DEBUG && err.name !== 'FetchError') {
       console.error(`[FETCH:FAIL][${label}] ${method} ${url}`);
       if (options.body) console.error(`Req Body: ${String(options.body).slice(0, 1000)}`);
       console.error(`Error: ${err.message}`);
    }
    // Re-throw so caller can catch and use logError
    throw err;
  }
}

// --- Self Check ---

async function runSelfCheck() {
  if (IS_DEBUG) {
    console.log('--- START SELF CHECK ---');
    // A. Environment
    console.log('[ENV] Node:', process.version);
    console.log('[ENV] Platform:', process.platform);
    console.log('[ENV] RPC_URL:', RPC_URL || '(empty)');
    
    const proxies = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'];
    proxies.forEach(p => {
      if (process.env[p]) {
        try {
          const u = new URL(process.env[p]);
          console.log(`[ENV] ${p}: ${u.host}`);
        } catch {
          console.log(`[ENV] ${p}: (invalid url)`);
        }
      } else {
        console.log(`[ENV] ${p}: (not set)`);
      }
    });
  } else {
    process.stdout.write('[INIT] Self check... ');
  }

  // B. Proxy Verification (if enabled)
  if (IS_PROXY_ENABLED) {
    logDebug('[SELFTEST:PROXY] Verifying proxy with ipify...');
    try {
      const ipData = await fetchJson('https://api.ipify.org?format=json', {}, { label: 'PROXY:check' });
      logDebug(`[SELFTEST:PROXY] OK. Public IP: ${ipData.ip}`);
    } catch (err) {
      logError('SELFTEST:PROXY', err);
      console.error('WARNING: Proxy is enabled but ipify check failed.');
      // We don't exit here, just warn so we can see if RPC works
    }
  }

  // C. RPC Reachability
  logDebug('[SELFTEST:RPC] Checking connectivity...');
  try {
    await fetchJson(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' })
    }, { label: 'RPC:getHealth' });
    
    await fetchJson(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' })
    }, { label: 'RPC:getLatestBlockhash' });
    
    logDebug('[SELFTEST:RPC] OK');
  } catch (err) {
    if (!IS_DEBUG) console.log('FAIL');
    logError('SELFTEST:RPC', err);
    console.error('SUGGESTION: Check your RPC_URL, DNS, or Proxy settings.');
    process.exit(1);
  }

  // D. Jupiter Reachability
  logDebug('[SELFTEST:JUPITER] Checking quote API...');
  try {
    const testUrl = 'https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&swapMode=ExactIn';
    const headers = {};
    if (JUP_API_KEY) {
      headers['x-api-key'] = JUP_API_KEY;
    }
    await fetchJson(testUrl, { headers }, { label: 'JUPITER:quote' });
    logDebug('[SELFTEST:JUPITER] OK');
  } catch (err) {
    if (!IS_DEBUG) console.log('FAIL');
    if (err.status === 401) {
      console.error('[ERROR][SELFTEST:JUPITER] 401 Unauthorized. Missing or invalid JUP_API_KEY.');
      if (err.body) {
         console.error(`Response Body: ${err.body.slice(0, 500)}`);
      }
      process.exit(1);
    }
    logError('SELFTEST:JUPITER', err);
    console.error('SUGGESTION: Check if api.jup.ag is blocked or requires proxy.');
    process.exit(1);
  }

  if (IS_DEBUG) {
    console.log('--- SELF CHECK PASSED ---');
  } else {
    console.log('PASS');
  }
}


// --- Logic ---


function assertMnemonic(m) {
  if (!m || typeof m !== 'string') {
    throw new Error('Missing SOLANA_MNEMONIC in environment');
  }
  const words = m.trim().split(/\s+/);
  if (words.length !== 24) {
    throw new Error('SOLANA_MNEMONIC must be 24 words');
  }
  if (!bip39.validateMnemonic(m)) {
    throw new Error('Invalid mnemonic format');
  }
}

function deriveKeypairFromMnemonic(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const path = `m/44'/501'/0'/0'`;
  const derived = derivePath(path, seed.toString('hex'));
  const kp = Keypair.fromSeed(Buffer.from(derived.key));
  return kp;
}

async function getSolBalance(connection, pubkey) {
  try {
    logDebug(`[STEP:getBalance] SOL for ${pubkey.toBase58()}`);
    const lamports = await connection.getBalance(pubkey, 'confirmed');
    return lamports;
  } catch (err) {
    logError('getBalance', err);
    throw err;
  }
}

async function getUsdcAccountPubkey(connection, owner) {
  try {
    const resp = await connection.getTokenAccountsByOwner(owner, { mint: new PublicKey(USDC_MINT) }, 'confirmed');
    if (!resp.value || resp.value.length === 0) return null;
    return new PublicKey(resp.value[0].pubkey);
  } catch (err) {
    logError('getTokenAccountsByOwner', err);
    throw err;
  }
}

async function getUsdcBalance(connection, owner) {
  const ata = await getUsdcAccountPubkey(connection, owner);
  if (!ata) return { amount: 0n, decimals: 6 };
  try {
    logDebug(`[STEP:getTokenAccountBalance] USDC ATA ${ata.toBase58()}`);
    const bal = await connection.getTokenAccountBalance(ata, 'confirmed');
    const amount = BigInt(bal.value.amount);
    const decimals = bal.value.decimals ?? 6;
    return { amount, decimals };
  } catch (err) {
    logError('getTokenAccountBalance', err);
    throw err;
  }
}

function bigintToUiString(amountBigInt, decimals) {
  const negative = amountBigInt < 0n;
  const abs = negative ? -amountBigInt : amountBigInt;
  const s = abs.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals);
  const fracPart = s.slice(s.length - decimals);
  const trimmedFrac = fracPart.replace(/0+$/, '');
  const res = trimmedFrac.length ? `${intPart}.${trimmedFrac}` : intPart;
  return negative ? `-${res}` : res;
}

function numberToLamports(numSol) {
  return BigInt(Math.round(numSol * LAMPORTS_PER_SOL));
}

function numberToTokenUnits(num, decimals) {
  const factor = 10 ** decimals;
  return BigInt(Math.round(num * factor));
}

async function jupiterQuote({ inputMint, outputMint, amount, slippageBps, excludeDexes, onlyDirectRoutes, swapMode = 'ExactIn' }) {
  const url = new URL('https://api.jup.ag/swap/v1/quote');
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amount.toString());
  url.searchParams.set('slippageBps', slippageBps.toString());
  url.searchParams.set('swapMode', swapMode);
  if (excludeDexes) url.searchParams.set('excludeDexes', excludeDexes);
  if (onlyDirectRoutes) url.searchParams.set('onlyDirectRoutes', 'true');

  const headers = {};
  if (JUP_API_KEY) {
    headers['x-api-key'] = JUP_API_KEY;
  }

  try {
    const json = await fetchJson(url.toString(), { headers }, { label: 'JUPITER:quote' });
    return json;
  } catch (err) {
    logError('jupiterQuote', err);
    throw err;
  }
}

async function jupiterSwap({ quoteResponse, userPublicKey }) {
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: null
  };
  
  const headers = { 'Content-Type': 'application/json' };
  if (JUP_API_KEY) {
    headers['x-api-key'] = JUP_API_KEY;
  }

  try {
    const json = await fetchJson('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }, { label: 'JUPITER:swap' });
    const cul = json.computeUnitLimit;
    const pfee = json.prioritizationFeeLamports;
    if (cul !== undefined || pfee !== undefined) {
      logDebug(`[SWAP] computeUnitLimit=${cul ?? 'n/a'} prioritizationFeeLamports=${pfee ?? 'n/a'}`);
    }
    return json;
  } catch (err) {
    logError('jupiterSwap', err);
    throw err;
  }
}

function getRouteLabels(quote) {
  try {
    const plan = quote.routePlan || [];
    return plan.map(p => p.label).filter(Boolean);
  } catch {
    return [];
  }
}

function hasMeteoraDLMM(quote) {
  const labels = getRouteLabels(quote);
  return labels.some(l => String(l).toLowerCase().includes('meteora') && String(l).toLowerCase().includes('dlmm'));
}

function logsContainExceededCUs(logs) {
  const text = Array.isArray(logs) ? logs.join('\n') : String(logs || '');
  const patterns = ['exceeded CUs meter', 'computational budget exhausted', 'ComputationalBudget'];
  return patterns.some(p => text.toLowerCase().includes(p.toLowerCase()));
}

async function simulateSwap(connection, tx) {
  try {
    const sim = await connection.simulateTransaction(tx, { sigVerify: false });
    return sim.value;
  } catch (err) {
    logError('simulateTransaction', err);
    throw err;
  }
}

async function confirmByPolling(connection, signature, timeoutMs = 60000, intervalMs = 2000, silent = false) {
  // Confirmation policy: disable WebSocket, use HTTP polling via getSignatureStatuses for simplicity and reliability
  const start = Date.now();
  if (!silent) logDebug(`[CONFIRM] Polling for signature: ${signature}`);

  while (Date.now() - start < timeoutMs) {
    try {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = value && value[0];

      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          const duration = Date.now() - start;
          if (!silent) {
            logDebug(`[CONFIRM] Status: ${status.confirmationStatus}`);
            console.log(`[CONFIRM] Total time: ${duration}ms`);
          }
          return { status: status.confirmationStatus, duration };
        }
      }
    } catch (err) {
      if (err.message.startsWith('Transaction failed')) throw err;
      // ignore network errors during polling
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('CONFIRM_TIMEOUT');
}

// --- Helpers ---

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// --- Modes ---

async function runSingleSwap(connection, keypair, direction) {
  const publicKey = keypair.publicKey;

  // --- Pre-Swap Balance ---
  const preSolLamports = await getSolBalance(connection, publicKey);
  const preUsdc = await getUsdcBalance(connection, publicKey);
  const preSolStr = bigintToUiString(BigInt(preSolLamports), 9);
  const preUsdcStr = bigintToUiString(preUsdc.amount, preUsdc.decimals);

  console.log(`Swap direction: ${direction}`);
  console.log(`Before: SOL balance = ${preSolStr} | USDC balance = ${preUsdcStr}`);

  let inputMint;
  let outputMint;
  let inputAmount;
  if (direction === 'SOL_TO_USDC') {
    inputMint = SOL_MINT;
    outputMint = USDC_MINT;
    inputAmount = numberToLamports(AMOUNT_SOL_TO_USDC_SOL);
  } else {
    inputMint = USDC_MINT;
    outputMint = SOL_MINT;
    inputAmount = numberToTokenUnits(AMOUNT_USDC_TO_SOL_USDC, 6);
  }

  let attempt = 1;
  let excludeDexes = undefined;
  let onlyDirectRoutes = undefined;
  let quote, swapRes, tx, simValue;

  while (attempt <= 3) {
    quote = await jupiterQuote({
      inputMint,
      outputMint,
      amount: inputAmount,
      slippageBps: SLIPPAGE_BPS,
      excludeDexes,
      onlyDirectRoutes
    });

    const labels = getRouteLabels(quote);
    logDebug(`[QUOTE] Params: excludeDexes=${excludeDexes ?? 'none'} onlyDirectRoutes=${onlyDirectRoutes ? 'true' : 'false'}`);
    if (labels.length) {
      logDebug(`[QUOTE] Route labels: ${labels.join(' -> ')}`);
    } else {
      logDebug(`[QUOTE] Route labels: none`);
    }

  const inAmountUi = inputMint === SOL_MINT
    ? bigintToUiString(BigInt(quote.inAmount), 9)
    : bigintToUiString(BigInt(quote.inAmount), 6);
  const outAmountUi = outputMint === SOL_MINT
    ? bigintToUiString(BigInt(quote.outAmount), 9)
    : bigintToUiString(BigInt(quote.outAmount), 6);

  console.log(`Quote: inAmount = ${inAmountUi} | outAmount = ${outAmountUi}`);
  if (IS_DEBUG) {
     console.log(`[QUOTE] Full JSON:\n${JSON.stringify(quote, null, 2)}`);
  }

    swapRes = await jupiterSwap({
      quoteResponse: quote,
      userPublicKey: publicKey.toBase58()
    });

    const txBufLocal = Buffer.from(swapRes.swapTransaction, 'base64');
    tx = VersionedTransaction.deserialize(txBufLocal);
    tx.sign([keypair]);

    const sim = await simulateSwap(connection, tx);
    simValue = sim;
    if (sim.err) {
      console.error(`[SIMULATE][ERR] ${JSON.stringify(sim.err)}`);
      if (sim.logs && sim.logs.length) {
        console.error(`[SIMULATE][LOGS]\n${sim.logs.join('\n')}`);
      }
    }

    const needExclude = hasMeteoraDLMM(quote);
    const needRequoteForCUs = sim.err && logsContainExceededCUs(sim.logs);

    if (attempt === 1 && (needExclude || needRequoteForCUs)) {
      excludeDexes = 'Meteora+DLMM';
      attempt++;
      continue;
    }
    if (attempt === 2 && (sim.err && needRequoteForCUs)) {
      onlyDirectRoutes = true;
      attempt++;
      continue;
    }
    break;
  }

  if (simValue && simValue.err) {
    console.error('[SIMULATE] Final simulation failed');
    process.exit(1);
  }

  let sig;
  try {
    logDebug('[STEP:sendTransaction] Sending...');
    sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    console.log(`Transaction signature: ${sig}`);
  } catch (err) {
    logError('sendRawTransaction', err);
    throw err;
  }

  try {
    await confirmByPolling(connection, sig);
  } catch (err) {
    logError('confirmByPolling', err);
    // proceed to balance check anyway
  }

  // --- Post-Swap Balance ---
  const postSolLamports = await getSolBalance(connection, publicKey);
  const postUsdc = await getUsdcBalance(connection, publicKey);
  const postSolStr = bigintToUiString(BigInt(postSolLamports), 9);
  const postUsdcStr = bigintToUiString(postUsdc.amount, postUsdc.decimals);

  console.log(`After: SOL balance = ${postSolStr} | USDC balance = ${postUsdcStr}`);

  const deltaSol = BigInt(postSolLamports) - BigInt(preSolLamports);
  const deltaUsdc = postUsdc.amount - preUsdc.amount;
  
  const deltaSolStr = bigintToUiString(deltaSol, 9);
  const deltaUsdcStr = bigintToUiString(deltaUsdc, 6);

  console.log(`Delta: SOL = ${deltaSolStr} | USDC = ${deltaUsdcStr}`);
  
  // Final Result Line
  if (deltaSol < 0n && deltaUsdc > 0n) {
    console.log('Result: SOL -> USDC (SOL delta includes fees)');
  } else if (deltaSol > 0n && deltaUsdc < 0n) {
    console.log('Result: USDC -> SOL (SOL delta includes fees)');
  } else {
    console.log('Result: mixed/fees only (check logs)');
  }
}

// --- PnL Helpers ---

async function getSolPriceInUsdc() {
  try {
    // 0.01 SOL = 10_000_000 lamports
    const amount = 10000000n;
    const quote = await jupiterQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount,
      slippageBps: 50,
      swapMode: 'ExactIn'
    });
    // quote.outAmount is in 6 decimals (USDC)
    const outUsdc = Number(quote.outAmount) / 1000000;
    const price = outUsdc / 0.01; // price per 1 SOL
    return price;
  } catch (err) {
    // just log and return 0 so we don't crash
    console.error(`[PRICE] Failed to fetch SOL price: ${err.message}`);
    return 0;
  }
}

function buildDripSummaryText(s) {
  // s is the summary object
  // Format:
  // *SOL Jupiter DRIP Summary*
  // Start: SOL=... | USDC=...
  // End:   SOL=... | USDC=...
  // Net:   SOL=... | USDC=...
  // SOL price: start=... end=... avg=...
  // Net value (est): +... USDC
  // Stats: planned=... attempted=... success=... skipped=... failed=...
  // Elapsed: ...ms
  // Time: ...
  // Wallet: ...

  const walletAbbr = `${s.wallet.slice(0, 4)}...${s.wallet.slice(-4)}`;
  // Local time in Asia/Tokyo
  const timeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour12: false }) + ' JST';

  let text = `*SOL Jupiter DRIP Summary*\n`;
  if (s.status && s.status !== 'SUCCESS') {
    text += `Status: ${s.status}`;
    if (s.error) text += ` (${s.error})`;
    text += `\n`;
  }
  
  text += `Start: SOL=${s.startSol} | USDC=${s.startUsdc}\n`;
  text += `End:   SOL=${s.endSol} | USDC=${s.endUsdc}\n`;
  text += `Net:   SOL=${s.netSol} | USDC=${s.netUsdc}\n`;
  text += `SOL price: start=${s.startSolPrice.toFixed(2)} end=${s.endSolPrice.toFixed(2)} avg=${s.avgPrice.toFixed(2)}\n`;
  text += `Net value (est): ${s.netValueStr}\n`;
  text += `Stats: planned=${s.totalTrades} attempted=${s.stats.total} success=${s.stats.success} skipped=${s.stats.skipped} failed=${s.stats.failed}\n`;
  text += `Elapsed: ${s.elapsed}ms\n`;
  text += `Time: ${timeStr}\n`;
  text += `Wallet: \`${walletAbbr}\`\n`;

  return text;
}

async function runDripMode(connection, keypair, { walletLabel = null } = {}) {
  // 1. Config
  const TOTAL_TRADES = parseInt(process.env.DRIP_TRADES || '150', 10);
  const WINDOW_SEC = parseInt(process.env.DRIP_WINDOW_SEC || '3600', 10);
  const USDC_MIN = parseFloat(process.env.DRIP_USDC_MIN || '2');
  const USDC_MAX = parseFloat(process.env.DRIP_USDC_MAX || '3');
  const JITTER_PCT = parseFloat(process.env.DRIP_JITTER_PCT || '0.35');
  const START_DIR = (process.env.DRIP_START_DIRECTION || 'SOL_TO_USDC').toUpperCase();
  const MIN_DELAY = parseInt(process.env.DRIP_MIN_DELAY_SEC || '5', 10);
  const FAIL_BACKOFF = parseInt(process.env.DRIP_FAIL_BACKOFF_SEC || '20', 10) * 1000;
  const SKIP_INSUFFICIENT = process.env.DRIP_SKIP_IF_INSUFFICIENT !== 'false';
  const IS_DRY_RUN = process.env.DRIP_DRY_RUN === 'true';

  console.log(`[DRIP] Mode STARTED`);
  if (walletLabel) console.log(`[DRIP] Wallet Label: ${walletLabel}`);
  console.log(`[DRIP] Config: ${TOTAL_TRADES} trades in ${WINDOW_SEC}s`);
  console.log(`[DRIP] Amount: ${USDC_MIN}-${USDC_MAX} USDC`);
  console.log(`[DRIP] Start: ${START_DIR}`);
  if (IS_DRY_RUN) console.log(`[DRIP] DRY RUN ENABLED (no actual swaps)`);

  // Scheduler: base interval derived from window/total; jitter adds randomness; clamp ensures sane min/max spacing
  const baseInterval = WINDOW_SEC / TOTAL_TRADES;
  const publicKey = keypair.publicKey;
  let currentDir = START_DIR;
  
  const stats = {
    success: 0,
    skipped: 0,
    failed: 0,
    total: 0
  };
  
  const startTime = Date.now();
  
  // Cache USDC ATA to avoid repeated fetching
  let usdcAta = null;
  try {
      usdcAta = await getUsdcAccountPubkey(connection, publicKey);
  } catch(e) { /* ignore */ }

  // Initial Price & Balance Snapshot
  console.log('[DRIP] Fetching initial SOL price and balances...');
  const startSolPrice = await getSolPriceInUsdc();
  console.log(`SOL price (start): ${startSolPrice.toFixed(2)} USDC`);

  let startSol = 0n;
  let startUsdc = 0n;

  try {
      startSol = BigInt(await connection.getBalance(publicKey, 'confirmed'));
      if (usdcAta) {
          const bal = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
          startUsdc = BigInt(bal.value.amount);
      } else {
          const p = await getUsdcBalance(connection, publicKey);
          startUsdc = p.amount;
          // try to get ATA again if not found before
          if (!usdcAta) usdcAta = await getUsdcAccountPubkey(connection, publicKey);
      }
  } catch (err) {
      logError('DRIP:initBalances', err);
      console.log('[DRIP] Warning: Failed to get initial balances. PnL may be inaccurate.');
      // Ensure they are BigInts even if failed (already initialized to 0n, but if partial fail?)
  }

  // Graceful exit handler
  let isExiting = false;
  let exitReason = 'SUCCESS'; // SUCCESS | INTERRUPTED | FAILED
  let exitError = '';

  // Trigger summary generation and notification
  const finishDrip = async () => {
      // Avoid double summary
      if (finishDrip.done) return;
      finishDrip.done = true;
      
      console.log('\n================ DRIP SUMMARY ================');
      
      // End Price & Balance
      const endSolPrice = await getSolPriceInUsdc();
      
      let endSol = 0n;
      let endUsdc = 0n;
      try {
          endSol = BigInt(await connection.getBalance(publicKey, 'confirmed'));
          if (usdcAta) {
             const bal = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
             endUsdc = BigInt(bal.value.amount);
          } else {
             const p = await getUsdcBalance(connection, publicKey);
             endUsdc = p.amount;
          }
      } catch (err) {
          console.log('[DRIP] Failed to get final balances for summary');
      }

      const netSol = endSol - startSol;
      const netUsdc = endUsdc - startUsdc;

      // Formatting
      const sSol = bigintToUiString(startSol, 9);
      const sUsdc = bigintToUiString(startUsdc, 6);
      const eSol = bigintToUiString(endSol, 9);
      const eUsdc = bigintToUiString(endUsdc, 6);
      const nSol = bigintToUiString(netSol, 9);
      const nUsdc = bigintToUiString(netUsdc, 6);

      console.log(`Start balances:  SOL=${sSol} | USDC=${sUsdc}`);
      console.log(`End balances:    SOL=${eSol} | USDC=${eUsdc}`);
      console.log(`Net change:      SOL=${nSol} | USDC=${nUsdc}`);
      
      console.log(`SOL price (start): ${startSolPrice.toFixed(2)} USDC`);
      console.log(`SOL price (end):   ${endSolPrice.toFixed(2)} USDC`);
      
      let avgPrice = 0;
      if (startSolPrice > 0 && endSolPrice > 0) {
          avgPrice = (startSolPrice + endSolPrice) / 2;
      } else if (startSolPrice > 0) {
          avgPrice = startSolPrice;
      } else {
          avgPrice = endSolPrice;
      }
      
      console.log(`SOL price (avg):   ${avgPrice.toFixed(2)} USDC`);
      
      // Net Value (USDC est) = netUsdc + (netSol * avgPrice)
      const netSolFloat = parseFloat(nSol);
      const netUsdcFloat = parseFloat(nUsdc);
      const netValue = netUsdcFloat + (netSolFloat * avgPrice);
      const sign = netValue >= 0 ? '+' : '';
      const netValueStr = `${sign}${netValue.toFixed(2)} USDC`;
      
      console.log(`Net value (est):   ${netValueStr}   (netUsdc + netSol*avgPrice)`);
      
      const elapsed = Date.now() - startTime;
      console.log(`Stats: planned=${TOTAL_TRADES} attempted=${stats.total} success=${stats.success} skipped=${stats.skipped} failed=${stats.failed} elapsed=${elapsed}ms`);
      console.log('==============================================');

      // TG Notification
      if (TG_ENABLED) {
        const summaryObj = {
          wallet: publicKey.toBase58(),
          status: exitReason,
          error: exitError,
          startSol: sSol,
          startUsdc: sUsdc,
          endSol: eSol,
          endUsdc: eUsdc,
          netSol: nSol,
          netUsdc: nUsdc,
          startSolPrice,
          endSolPrice,
          avgPrice,
          netValueStr,
          totalTrades: TOTAL_TRADES,
          stats,
          elapsed
        };

        // 1. Save State
        saveDripState({
          lastRunAt: new Date().toISOString(),
          lastSummary: summaryObj,
          exitReason,
          exitError,
          stats
        }, walletLabel);

        const msg = buildDripSummaryText(summaryObj);

        // 2. Append Log
        appendSummaryLog(msg);

        // 3. Send Telegram
        await sendTelegram(msg, {
          botToken: TG_BOT_TOKEN,
          chatId: TG_CHAT_ID,
          enabled: TG_ENABLED,
          timeoutMs: TG_TIMEOUT_MS,
          maxRetry: TG_MAX_RETRY
        });
      }
  };

  process.once('SIGINT', async () => {
      console.log('\n[DRIP] Caught interrupt signal (SIGINT). Stopping...');
      isExiting = true;
      exitReason = 'INTERRUPTED';
      // The loop checks isExiting and will break.
      // We rely on the finally block to call finishDrip()
  });

  try {
    for (let i = 1; i <= TOTAL_TRADES; i++) {
        if (isExiting) break;
        stats.total++;
        
        // 2. Schedule
        const jitter = randomFloat(-JITTER_PCT, JITTER_PCT);
        let delaySec = baseInterval * (1 + jitter);
        delaySec = clamp(delaySec, MIN_DELAY, 120);
        
        // 3. Target Amount
        const targetUsdc = parseFloat(randomFloat(USDC_MIN, USDC_MAX).toFixed(2));
        
        console.log(`\n[DRIP ${i}/${TOTAL_TRADES}] dir=${currentDir} target=${targetUsdc} USDC delay=${delaySec.toFixed(1)}s`);

        // 4. Balances
        let preSol = 0n;
        let preUsdc = { amount: 0n, decimals: 6 };
        
        try {
            preSol = BigInt(await connection.getBalance(publicKey, 'confirmed'));
            if (usdcAta) {
                const bal = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
                preUsdc = { amount: BigInt(bal.value.amount), decimals: bal.value.decimals };
            } else {
                preUsdc = await getUsdcBalance(connection, publicKey);
                usdcAta = await getUsdcAccountPubkey(connection, publicKey); 
            }
        } catch (err) {
            logError('DRIP:getBalance', err);
            console.log('[DRIP] Failed to get balances, waiting backoff...');
            await sleep(FAIL_BACKOFF);
            // Continue but do NOT switch direction? Or switch?
            // Usually continue implies retry or skip. Let's assume we can't proceed with this slot.
            continue;
        }

        // 5. Quote Params
        let inputMint, outputMint, amountParam, swapMode;
        
        if (currentDir === 'USDC_TO_SOL') {
            inputMint = USDC_MINT;
            outputMint = SOL_MINT;
            amountParam = numberToTokenUnits(targetUsdc, 6);
            // Amount math: USDC uses 6 decimals (1e6). ExactIn means input is fixed USDC.
            swapMode = 'ExactIn';
        } else {
            inputMint = SOL_MINT;
            outputMint = USDC_MINT;
            amountParam = numberToTokenUnits(targetUsdc, 6);
            // Amount math: SOL uses lamports (1e9) but here we specify USDC output in 1e6 units. ExactOut guarantees output amount.
            swapMode = 'ExactOut';
        }
        
        // 6. Get Quote
        let quote;
        try {
        quote = await jupiterQuote({
            inputMint,
            outputMint,
            amount: amountParam,
            slippageBps: SLIPPAGE_BPS,
            swapMode
        });
        } catch (err) {
            console.log(`[DRIP] Quote failed: ${err.message}`);
            await sleep(FAIL_BACKOFF);
            stats.failed++;
            // Switch direction to keep alternating schedule
            currentDir = currentDir === 'SOL_TO_USDC' ? 'USDC_TO_SOL' : 'SOL_TO_USDC';
            continue;
        }
        
        const inLamports = BigInt(quote.inAmount);
        const outLamports = BigInt(quote.outAmount);
        
        const inUi = currentDir === 'SOL_TO_USDC' ? bigintToUiString(inLamports, 9) : bigintToUiString(inLamports, 6);
        const outUi = currentDir === 'SOL_TO_USDC' ? bigintToUiString(outLamports, 6) : bigintToUiString(outLamports, 9);
        
        console.log(`Quote: in=${inUi} out=${outUi}`);
        
        // 7. Check Insufficient Funds
        let sufficient = true;
        if (currentDir === 'SOL_TO_USDC') {
            // Balance check: reserve ~0.002 SOL as a conservative fee buffer to avoid underfunded transactions
            const required = inLamports + BigInt(2000000); // ~0.002 SOL buffer
            if (BigInt(preSol) < required) {
                console.log(`[SKIP] insufficient SOL. Have: ${bigintToUiString(BigInt(preSol), 9)}, Need: ${bigintToUiString(required, 9)}`);
                sufficient = false;
            }
        } else {
            const required = inLamports + BigInt(50000); // ~0.05 USDC buffer
            if (preUsdc.amount < required) {
                console.log(`[SKIP] insufficient USDC. Have: ${bigintToUiString(preUsdc.amount, 6)}, Need: ${bigintToUiString(required, 6)}`);
                sufficient = false;
            }
        }
        
        if (!sufficient) {
            if (SKIP_INSUFFICIENT) {
                stats.skipped++;
                currentDir = currentDir === 'SOL_TO_USDC' ? 'USDC_TO_SOL' : 'SOL_TO_USDC';
                await sleep(delaySec * 1000);
                continue;
            }
        }
        
        if (IS_DRY_RUN) {
            console.log('[DRIP] Dry run: Swap skipped.');
            stats.success++;
        } else {
            // 8. Swap
            try {
                const swapRes = await jupiterSwap({
                    quoteResponse: quote,
                    userPublicKey: publicKey.toBase58()
                });
                
                const txBuf = Buffer.from(swapRes.swapTransaction, 'base64');
                const tx = VersionedTransaction.deserialize(txBuf);
                tx.sign([keypair]);
                
                // Send
                const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
                process.stdout.write(`Sig: ${sig.slice(0, 8)}... `);
                
                // Confirm
                const conf = await confirmByPolling(connection, sig, 60000, 2000, true);
                console.log(`| Confirm: ${conf.status} in ${conf.duration}ms`);
                
                // Delta
                const postSol = BigInt(await connection.getBalance(publicKey, 'confirmed'));
                let postUsdcAmt = 0n;
                if (usdcAta) {
                    const b = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
                    postUsdcAmt = BigInt(b.value.amount);
                } else {
                    const p = await getUsdcBalance(connection, publicKey);
                    postUsdcAmt = p.amount;
                }
                
                const dSol = BigInt(postSol) - BigInt(preSol);
                const dUsdc = postUsdcAmt - preUsdc.amount;
                
                console.log(`Delta: SOL ${bigintToUiString(dSol, 9)} | USDC ${bigintToUiString(dUsdc, 6)}`);
                stats.success++;
                
            } catch (err) {
                console.log(`\n[DRIP] Swap failed: ${err.message}`);
                stats.failed++;
                await sleep(FAIL_BACKOFF);
                currentDir = currentDir === 'SOL_TO_USDC' ? 'USDC_TO_SOL' : 'SOL_TO_USDC';
                continue; 
            }
        }

        currentDir = currentDir === 'SOL_TO_USDC' ? 'USDC_TO_SOL' : 'SOL_TO_USDC';
        
        // Summary
        if (i % 10 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = (TOTAL_TRADES - i) * (elapsed / i);
            console.log(`\n[SUMMARY] ${i}/${TOTAL_TRADES} | OK:${stats.success} SKIP:${stats.skipped} FAIL:${stats.failed}`);
            console.log(`Time: ${elapsed.toFixed(0)}s elapsed, ~${remaining.toFixed(0)}s remaining`);
            const nowSol = await connection.getBalance(publicKey, 'confirmed');
            console.log(`Balance: ${bigintToUiString(BigInt(nowSol), 9)} SOL`);
        }

        await sleep(delaySec * 1000);
    }
  } catch (err) {
      // Capture fatal errors in the main loop wrapper
      exitReason = 'FAILED';
      exitError = err.message;
      throw err;
  } finally {
      // Ensure summary is printed if not already exiting via signal
      await finishDrip();
  }
}

async function runMultiDrip(connection) {
  const wallets = [];
  
  // 1. Load from Env (WALLET_1_MNEMONIC, WALLET_2_MNEMONIC, ...)
  let i = 1;
  while (process.env[`WALLET_${i}_MNEMONIC`]) {
    wallets.push({
      id: `w${i}`,
      mnemonic: process.env[`WALLET_${i}_MNEMONIC`]
    });
    i++;
  }

  // 2. Load from JSON (optional)
  const jsonPath = 'wallets.json';
  if (fs.existsSync(jsonPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      // Support array of strings or objects
      if (Array.isArray(json)) {
        json.forEach((item, idx) => {
          if (typeof item === 'string') {
            wallets.push({ id: `json_${idx + 1}`, mnemonic: item });
          } else if (item && item.mnemonic) {
            wallets.push({ id: item.id || `json_${idx + 1}`, mnemonic: item.mnemonic });
          }
        });
      }
    } catch (err) {
      console.error(`[MULTI] Failed to load ${jsonPath}: ${err.message}`);
    }
  }

  if (wallets.length === 0) {
    console.error('[MULTI] No wallets found. Set WALLET_1_MNEMONIC in .env or create wallets.json');
    process.exit(1);
  }

  console.log(`[MULTI] Starting orchestrator for ${wallets.length} wallets...`);
  
  // Launch in parallel with staggered start to reduce RPC spike
  const promises = wallets.map(async (w, idx) => {
    // Stagger start by 2 seconds per wallet
    await sleep(idx * 2000);
    try {
      console.log(`[MULTI] Initializing wallet ${w.id}...`);
      assertMnemonic(w.mnemonic);
      const kp = deriveKeypairFromMnemonic(w.mnemonic);
      await runDripMode(connection, kp, { walletLabel: w.id });
    } catch (err) {
      console.error(`[MULTI] Wallet ${w.id} failed to start: ${err.message}`);
    }
  });

  await Promise.all(promises);
  console.log('[MULTI] All wallets finished.');
}

async function main() {
  console.log(`[INIT] Node version: ${process.version}`);
  
  const modeArg = (process.argv[2] || 'SOL_TO_USDC');

  // Strict Config Validation
  if (modeArg !== 'multi-drip' && !MNEMONIC) {
    console.error('[FATAL] Missing MNEMONIC or SOLANA_MNEMONIC in .env');
    process.exit(1);
  }
  if (!JUP_API_KEY) {
    console.error('[FATAL] Missing JUP_API_KEY in .env');
    process.exit(1);
  }
  
  if (TG_ENABLED) {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
      console.warn('[WARN] TG_ENABLED=true but missing TG_BOT_TOKEN or TG_CHAT_ID. Notifications disabled.');
    }
  }

  initNetwork();
  await runSelfCheck();

  let keypair;
  if (modeArg !== 'multi-drip') {
      assertMnemonic(MNEMONIC);
      keypair = deriveKeypairFromMnemonic(MNEMONIC);
  }
  
  const connection = new Connection(RPC_URL, 'confirmed');

  if (modeArg.toLowerCase() === 'drip') {
      await runDripMode(connection, keypair);
  } else if (modeArg === 'multi-drip') {
      await runMultiDrip(connection);
  } else if (modeArg === 'tg-test') {
      console.log(`[TG] Testing Telegram notification...`);
      const testMsg = `*TG test ok*\nTime: ${new Date().toLocaleString()}`;
      await sendTelegram(testMsg, {
          botToken: TG_BOT_TOKEN,
          chatId: TG_CHAT_ID,
          enabled: true, // Force enable for test
          timeoutMs: TG_TIMEOUT_MS,
          maxRetry: TG_MAX_RETRY
      });
      console.log(`[TG] Test finished.`);
  } else {
      const direction = modeArg.toUpperCase();
      if (!['SOL_TO_USDC', 'USDC_TO_SOL'].includes(direction)) {
        throw new Error('Usage: node mvp-swap.js SOL_TO_USDC | USDC_TO_SOL | drip');
      }
      console.log(`[ENV] Wallet Pubkey: ${keypair.publicKey.toBase58()}`);
      await runSingleSwap(connection, keypair, direction);

      // Single Swap TG Notification (Optional)
      if (TG_SINGLE_SWAP && TG_ENABLED) {
        // Just send a simple message for single swap
        const msg = `*Single Swap Completed*\nDir: ${direction}\nWallet: \`${keypair.publicKey.toBase58().slice(0,4)}...${keypair.publicKey.toBase58().slice(-4)}\``;
        await sendTelegram(msg, {
          botToken: TG_BOT_TOKEN,
          chatId: TG_CHAT_ID,
          enabled: TG_ENABLED,
          timeoutMs: TG_TIMEOUT_MS,
          maxRetry: TG_MAX_RETRY
        });
      }
  }
}


if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
