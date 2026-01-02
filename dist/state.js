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
exports.loadState = loadState;
exports.saveState = saveState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("./types");
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state_v2.json');
function loadState() {
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
                if (data.cycleState === types_1.CycleState.BOUGHT) {
                    return {
                        ...data,
                        completedTrades: 0, // Reset counters for new run
                        startTime: Date.now() // Reset timer
                    };
                }
            }
        }
        catch (e) {
            console.warn('[STATE] Failed to load existing state, starting fresh.', e);
        }
    }
    return {
        version: 2,
        completedTrades: 0,
        startTime: Date.now(),
        currentCycleId: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        cycleState: types_1.CycleState.INIT,
        currentRouteName: null,
        currentRouteTokenMint: null,
        lastBuyTx: null,
        lastBuyTime: null,
        lastBuyAmount: null
    };
}
function saveState(state) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
