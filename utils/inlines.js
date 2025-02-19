const { formatSOL, formatTriggerMode, emojiScore, formatDexscreenerPaid, formatFiat, buildWalletString, formatPercentage, formatNumber, calculatePositionStats, escapeTelegram } = require('./helper');
const { checkBalance } = require('./wallet');

function buildInlineButtons(wallet) {

    return [
        [
            { text: `${wallet.isActive ? '✅ Active' : '❌ Disabled'}`, callback_data: 'toggle_status' },
            { text: '✏️ Label', callback_data: 'set_label' },
        ],
        [
            { text: '🛠️ Auto-Buy', callback_data: 'show_buy_setting' },
            { text: '🛠️ Sell', callback_data: 'show_sell_setting' },
        ],
        // [
        //     { text: '🛠️ Sell all Tokens', callback_data: 'sell_all_token' },
        // ],
        [
            { text: `✏️ Min Liquidity: ${formatFiat(wallet.minLiquidity)}`, callback_data: 'set_min_liquidity' },
            { text: `✏️ Max Liquidity: ${formatFiat(wallet.maxLiquidity)}`, callback_data: 'set_max_liquidity' },
        ],
        [
            { text: `✏️ Min Mcap: ${formatFiat(wallet.minMcap)}`, callback_data: 'set_min_mcap' },
            { text: `✏️ Max Mcap: ${formatFiat(wallet.maxMcap)}`, callback_data: 'set_max_mcap' },
        ],
        [
            { text: `${wallet.isMev ? '✅' : '❌'} Anti-MEV`, callback_data: 'toggle_mev' },
            { text: `🛠️ Tip MEV: ${formatSOL(wallet.tipMev)}`, callback_data: 'set_mev_tip' },
        ],
        [
            { text: `🕒 Start: ${wallet.startHour !== null ? `${wallet.startHour}:00` : 'N/A'}`, callback_data: 'set_start_hour' },
            { text: `🕒 End: ${wallet.endHour !== null ? `${wallet.endHour}:00` : 'N/A'}`, callback_data: 'set_end_hour' },
        ],
        [
            { text: `${emojiScore(wallet.agScore)} Min AG Score`, callback_data: 'set_ag_score' },
            { text: `🕒 Deployer age: ${wallet.deployerAge} hours`, callback_data: 'set_deployer_age' },
        ],
        [
            { text: `🕒 TTC: ${wallet.ttc !== null ? `${wallet.ttc}` : 'N/A'}`, callback_data: 'set_ttc' },
            { text: `🛠️ Dexscreener Paid: ${formatDexscreenerPaid(wallet.dexscreenerPaid)}`, callback_data: 'set_dexscreener_paid' },
        ],
        [
            { text: `🎯 Trigger: ${formatTriggerMode(wallet.triggerMode)}`, callback_data: 'set_trigger' },
        ],
        [
            { text: `✏️ Priority Fee: ${formatSOL(wallet.priorityFee)}`, callback_data: 'set_priority' },
        ],
        [
            { text: '⬅️', callback_data: 'prev_wallet' },
            { text: 'Import Wallet', callback_data: 'import_wallet' },
            { text: '➡️', callback_data: 'next_wallet' },
        ],
    ];

}

function buildInlineMsg(wallet, balance) {

    return `${buildWalletString(wallet)}

<strong>SOL Balance:</strong> ${formatSOL(balance)}

<strong>Auto-Buy amount:</strong> ${wallet.buyAmount} SOL
<strong>Auto-Buy slippage:</strong> ${wallet.buySlippage}%

<strong>Sell slippage:</strong> ${wallet.sellSlippage}%`;
}

function buildTradeButtons(txId, wallet, isSell) {
    let btns = [
        [
            { text: '🎨 Flex', callback_data: `flex_profit_${txId}` },
            { text: '🥸 Incognito', callback_data: `flex_profit_incognito_${txId}` },
            { text: '🔄 Refresh', callback_data: `refresh_${txId}` },
        ],
    ];

    if (isSell) {
        btns = [
            [
                { text: `🪝 Sell ${wallet.sellPreset1}%`, callback_data: `make_sell_${txId}_${wallet.sellPreset1}` },
                { text: `🪝 Sell ${wallet.sellPreset2}%`, callback_data: `make_sell_${txId}_${wallet.sellPreset2}` },
            ],
            [
                { text: '🪝 Sell 100%', callback_data: `make_sell_${txId}_100` },
            ],
            [
                { text: '🪝 Sell Custom (enter integer as %)', callback_data: `custom_sell_${txId}` },
            ],
            ...btns,
        ];
    }

    return btns;
}

async function buildTradeMsg(wallet, buyTx, poolInfo, sellTxs = []) {
    const { initialSol, realizedSol, worthSol, icon, growthRate, elapsed } = calculatePositionStats(buyTx, poolInfo.poolObject.pricePerToken, sellTxs);

    const triggerMode = buyTx.triggerMode;
    const triggerModeStr = triggerMode ? `${formatTriggerMode(triggerMode)} ` : '';

    const walletBalance = await checkBalance(wallet);

    const dsLink = `<a href="https://dexscreener.com/solana/${buyTx.tokenId}">DS</a>`;
    const pfLink = `<a href="https://pump.fun/${buyTx.tokenId}">PF</a>`;

    let link = dsLink;
    let market = 'Raydium';
    if (poolInfo.poolObject.type === 'PUMPFUN') {
        link = pfLink;
        market = 'pump.fun';
    }

    return `📌 ${triggerModeStr}Trade
${buildWalletString(wallet)} - 💰 ${formatSOL(walletBalance)}
${icon} <strong>${escapeTelegram(poolInfo.symbol)}</strong> 🚀 <strong>${formatPercentage(growthRate)}</strong>
<code>${buyTx.tokenId}</code>
Initial: <strong>${formatNumber(initialSol, 3)} SOL</strong>
Worth: <strong>${formatNumber(worthSol)} SOL</strong>
Realized: <strong>${formatNumber(realizedSol)} SOL</strong>
Time elapsed: <strong>${elapsed}</strong>
Current Mcap: <strong>${formatFiat(poolInfo.poolObject.mcap)}</strong>
Market: <strong>${market}</strong>

Links: <strong>${link}</strong>`;
}

module.exports = { buildInlineMsg, buildInlineButtons, buildTradeButtons, buildTradeMsg };