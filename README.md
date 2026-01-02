# Solana Jupiter Anchor/Drip Bot

这是一个专为 **Anchor Roundtrip** 策略设计的 Solana 自动化交易机器人，支持多钱包管理。它利用 Jupiter 聚合器进行交易，并支持跨多个钱包的顺序执行。

## 1. 项目概览

本机器人自动执行 "Anchoring" 流程 —— 即在 USDC 和目标 Token 之间进行往返交易（买入再卖出），以产生交易量或管理仓位。它的设计目标是稳健、可视和易于管理。

**核心能力:**
*   **Anchor Roundtrip:** 自动执行 `USDC -> Token -> USDC` 的循环交易，次数可配置。
*   **多钱包支持:** 顺序在多个钱包上运行策略，避免触发 RPC 速率限制。
*   **Telegram 通知:** 每次运行结束后，直接向你的 Telegram 发送实时汇总。
*   **清晰日志:** 提供简洁易读的日志，并附带详细的资金对账汇总。

## 2. 功能特性

*   **多钱包 (顺序执行):** 逐个处理钱包列表。当前钱包完成后，下一个钱包才会开始，极大降低 RPC 负载（减少 429 错误）。
*   **Anchor Roundtrip 模式:**
    *   从配置列表中随机选择一个目标 Token。
    *   用 USDC 买入目标 Token。
    *   立即将目标 Token 卖回 USDC。
    *   重复执行 `N` 轮。
*   **清晰日志 + Anchor 汇总:**
    *   日志标准化 (`[LEG i/N]`)，便于解析。
    *   每次运行后生成综合汇总（初始余额 vs 最终余额，净 USDC 变化）。
*   **Telegram 通知:**
    *   每次 Anchor 运行结束后发送结构化汇总到 Telegram。
    *   通知包含计划/成功轮数、余额变化和净盈亏。
*   **高可用性:** 通过重试和指数退避机制，自动处理 RPC 限流 (429) 和网络错误。

## 3. 环境要求

*   **Node.js**: 版本 20 或更高。
*   **npm**: 随 Node.js 安装。
*   **Solana RPC 节点**: 一个可靠的 RPC URL (推荐使用私有 RPC 以保证稳定性)。

## 4. 安装说明

1.  **克隆仓库:**
    ```bash
    git clone <repository-url>
    cd <repository-name>
    ```

2.  **安装依赖:**
    ```bash
    npm install
    ```

## 5. 配置说明

1.  **创建 `.env` 文件:**
    复制示例文件以创建你的本地配置。
    ```bash
    cp .env.example .env
    ```

2.  **编辑 `.env`:**
    打开 `.env` 并填入必要字段。

    **最小可运行配置 (必须):**
    以下参数决定了机器人“能否跑起来”以及“怎么跑”，缺一不可：

    *   `WALLET_KEYS`: 你的钱包助记词。
    *   `JUP_API_KEY`: **(必须)** 用于获取 Jupiter 报价。未配置会导致无法获取路由。
    *   `DRIP_TOKENS_JSON`: 要交易的 Token 列表 (Anchor 目标)。
    *   `DRIP_TRADES`: 每个钱包执行的轮次上限 (如 10)。
    *   `DRIP_WINDOW_SEC`: 每个钱包的运行时间窗口 (如 3600 秒)。
    *   `DRIP_AMOUNT_MIN_USDC` / `DRIP_AMOUNT_MAX_USDC`: 每次交易金额范围。

    **网络连接配置 (强烈建议):**
    *   `HTTP_PROXY` / `HTTPS_PROXY`: **(强烈建议)** 本地运行极易触发限流 (429)，配置代理能显著提高稳定性。
        ```env
        HTTP_PROXY=http://127.0.0.1:7890
        HTTPS_PROXY=http://127.0.0.1:7890
        ```
    *   `SOLANA_RPC_URL`: 默认为 `https://api.mainnet-beta.solana.com`。一般无需修改，除非你有私有节点。

    **`.env` 配置示例:**
    ```env
    # --- 核心执行配置 (必须) ---
    WALLET_KEYS="seed phrase one ..., seed phrase two ..."
    JUP_API_KEY=你的JupiterKey
    DRIP_TRADES=10
    DRIP_WINDOW_SEC=3600
    DRIP_AMOUNT_MIN_USDC=0.1
    DRIP_AMOUNT_MAX_USDC=0.2
    DRIP_TOKENS_JSON='[{"mint":"So11111111111111111111111111111111111111112","decimals":9}]'

    # --- 网络配置 (强烈建议) ---
    HTTP_PROXY=http://127.0.0.1:7890
    HTTPS_PROXY=http://127.0.0.1:7890
    
    # --- RPC (默认即可) ---
    SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
    ```

## 6. 钱包设置

你可以通过 `.env` 中的 `WALLET_KEYS` 和 `WALLET_LABELS` 变量配置多个钱包。

*   **WALLET_KEYS**: 逗号分隔的助记词列表。
*   **WALLET_LABELS**: 逗号分隔的名称列表（可选），让日志更易读。

**示例:**
```env
WALLET_KEYS="phrase for wallet A, phrase for wallet B"
WALLET_LABELS="Alpha,Beta"
```

### 6.1 Anchor Token 列表配置

`DRIP_TOKENS_JSON` 变量定义了机器人将与 USDC 进行交易的 Token 池。

*   **格式**: Token 对象的 JSON 数组，每个对象代表一个 **目标 Token**。
*   **灵活性**: 你可以配置 **1 个或多个** Token。机器人每轮会随机选择一个。
*   **隐含基础资产**: 机器人自动使用 USDC 作为起始和结束资产。
*   **限制**: **不要** 在此列表中包含 USDC。

**示例 (多 Token 设置):**
此配置启用针对 **SOL** (9位小数) 和 **JUP** (6位小数) 的交易。

```env
DRIP_TOKENS_JSON='[
  {"mint":"So11111111111111111111111111111111111111112","decimals":9}, 
  {"mint":"JUPyiwrYJFskUPiHa7hkeR8VUtkWAqZSgSoYtDdHCw","decimals":6}
]'
```
*(注意: 在实际 .env 文件中，请保持 JSON 在一行内)*

**示例 (单 Token 设置):**
```env
DRIP_TOKENS_JSON='[{"mint":"So11111111111111111111111111111111111111112","decimals":9}]'
```

## 7. 运行机器人

要以 **Multi-Drip** 模式运行（推荐所有场景使用）：

```bash
npm run start -- multi-drip
```

此命令将：
1.  读取 `.env` 中的所有钱包。
2.  从第一个钱包开始。
3.  运行 **Anchor Roundtrip** 策略 (USDC -> Token -> USDC)。
4.  完成后等待 2 秒，然后处理下一个钱包。

> **注意**: 此模式专门运行新的 "Anchor Roundtrip" 策略。旧版的 SOL<->USDC drip 模式不会被 `multi-drip` 调用。

### 7.1 执行范围与时间控制

理解 `DRIP_TRADES` 和 `DRIP_WINDOW_SEC` 在多钱包模式下的作用非常重要：

*   **基于每个钱包 (PER WALLET)**: 这些设置 **独立** 应用于每个钱包。它们不会在所有钱包间共享。
*   **顺序执行**: 钱包一个接一个地运行。

**场景示例:**
*   **配置**: 2 个钱包 (A 和 B), `DRIP_TRADES=10`, `DRIP_WINDOW_SEC=3600`。
*   **行为**:
    1.  **钱包 A 开始**: 它有自己独立的 3600秒窗口来完成 10 笔交易。
    2.  **钱包 A 结束**: 完成 10 笔交易（或时间耗尽）后，钱包 A 停止。
    3.  **冷却**: 机器人等待 2 秒。
    4.  **钱包 B 开始**: 它开始一个 *新* 的 3600秒窗口来完成它自己的 10 笔交易。
    5.  **总耗时**: 大约 2 小时 (3600秒 + 3600秒)。

## 8. 日志与 Anchor 汇总

**交易分段日志 (Leg Logs):**
执行过程中，你会看到每笔 Swap "Leg" 的日志：
```
[LEG 1/8] USDC -> SOL   -1.000000 USDC   +0.006500 SOL
[LEG 2/8] SOL -> USDC   -0.006500 SOL   +0.998000 USDC
```
*   `i/N`: 当前 Leg 编号 / 总计划 Leg 数 (全局递增)。
*   `-x / +y`: 实际发送和接收的 Token 数量。

**Anchor 汇总 (Anchor Summary):**
每个钱包运行结束后，会打印一份汇总：
```
================ ANCHOR SUMMARY ================
Wallet Label: Alpha
Wallet: 8abc...xyz9
Config: planned=4 cycles | attempted=4 | success=4 | failed=0
...
Initial Balances: SOL=1.500 | USDC=100.00
Final Balances:   SOL=1.498 | USDC=99.95
Net USDC (est):   -0.0500 USDC
Elapsed: 45000ms
================================================
```
*   **Initial/Final Balances**: 运行 *前* 和 *后* 的余额快照。
*   **Net USDC**: 估算的 USDC 余额变化。

## 9. Telegram 通知

如果 `TG_ENABLED=true`，机器人会在每次 Anchor 运行结束后发送通知到你的 Telegram 群组。

*   **触发条件**: 每当生成 Anchor Summary 时发送。
*   **内容**: 包含钱包标签、循环统计、余额和净 USDC 变化。
*   **格式**: 采用专门设计的“卡片式”摘要，包含 emoji 视觉分组、关键指标（盈亏/成功率）和本地时间，方便手机快速阅读。
*   **可靠性**: 通知发送失败（如网络问题）会记录为警告，但 **不会** 停止机器人。下一个钱包将按计划继续。
*   **禁用**: 在 `.env` 中设置 `TG_ENABLED=false` 或 `ANCHOR_TG_NOTIFY=false` 即可关闭。

## 10. Anchor 模式重试策略说明

**一句话总结：**
“交易失败时，系统会最多再试几次，每次稍微等一会儿并放宽一点价格；默认只优先重试卖出，避免留下残仓风险。”

### 10.1 为什么需要重试？
在 Solana 链上高频交互时，Swap 失败是非常正常的现象。常见原因包括：
1.  **瞬时流动性不足**：你要买卖的 Token 突然池子变浅了。
2.  **滑点超限**：价格波动太快，超过了你设置的允许范围。
3.  **网络拥堵**：RPC 节点超时或区块链暂时处理不过来。

如果一遇到失败就停止，会导致大量任务中断，甚至导致 Token 卖不出去（烂在手里）。因此，本系统内置了一套理性的重试机制。

### 10.2 核心机制说明

1.  **有限次重试**：
    *   不会无限死循环。如果重试了 `ANCHOR_SWAP_RETRY_MAX` 次还是不行，系统就会果断放弃，标记为 Failed 并继续下一个任务。

2.  **指数退避 (Exponential Backoff)**：
    *   失败后不会立刻重试（立刻重试大概率还是挂）。
    *   系统会先等一小会儿（如 500ms），如果还不行，下次就等更久（1000ms, 2000ms...）。
    *   这给了链上状态“恢复正常”的时间。

3.  **动态滑点 (Dynamic Slippage)**：
    *   如果是价格波动导致的失败，用原参数重试没意义。
    *   系统会在每次重试时，自动把允许的滑点调高一点点（例如每次 +0.25%），直到达到你设定的上限（`ANCHOR_RETRY_SLIPPAGE_BPS_MAX`）。
    *   **目的**：宁可少赚一点点，也要确保成交。

4.  **智能风控（默认只重试卖出）**：
    *   **买入失败 (USDC -> Token)**：系统默认**不重试**。因为此时你的钱还是 USDC，非常安全。没买成大不了这一单不做，没风险。
    *   **卖出失败 (Token -> USDC)**：系统会**全力重试**。因为此时你手里拿着波动资产（Token），如果卖不出去，价格下跌就会亏损。所以必须优先保证“落袋为安”。

### 10.3 行为示例 (Example)

假设你设置了最大重试 2 次，每次滑点 +25 bps：
1.  **第 1 次尝试**：使用 50bps 滑点 -> 失败 (Custom:6024)。
2.  **等待 500ms**。
3.  **第 2 次尝试 (Retry 1)**：自动将滑点提高到 75bps (+25) -> 依然失败。
4.  **等待 1000ms** (指数退避)。
5.  **第 3 次尝试 (Retry 2)**：自动将滑点提高到 100bps -> **成功！**
6.  **日志显示**：`[RETRY] LEG 2/8 succeeded on attempt=3`

## 11. 调试模式 (Debug Mode)

如果遇到问题，可以在 `.env` 中启用调试模式：
```env
DEBUG=true
```

**作用:**
*   打印 RPC 调用和 Jupiter API 的完整 HTTP 请求与响应。
*   显示详细的错误堆栈信息。
*   有助于诊断 `Balance mismatch`（余额不匹配）或特定的 Swap 错误。

## 12. 常见问题 (Common Issues)

*   **RPC 429 Too Many Requests:**
    *   **原因**: 达到了 RPC 提供商的速率限制。
    *   **解决方法**: 使用私有 RPC URL (Helius, Triton, QuickNode 等) 或增加钱包之间的延迟。机器人会通过重试或返回空余额（日志显示 `?`）来优雅处理此问题。

*   **余额不匹配 / 资金不足 (Balance Mismatch / Insufficient Funds):**
    *   **原因**: 钱包没有足够的 SOL 支付手续费，或没有足够的 USDC 进行交换。
    *   **解决方法**: 启用 `DEBUG=true` 查看准确的余额检查过程。确保钱包资金充足。

*   **Telegram 未发送通知:**
    *   **检查**: 确认 `TG_BOT_TOKEN` 和 `TG_CHAT_ID` 正确无误。
    *   **测试**: 运行 `npm run start -- tg-test` 来验证连通性。
