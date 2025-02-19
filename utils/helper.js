function truncateAddress(address) {
    const truncatedAddress = address.substring(0, 6);
    return truncatedAddress;
}

function shortenAddress(address) {
    const truncatedAddress = address.substring(0, 4) + '...' + address.substring(address.length - 4);
    return truncatedAddress;
}

function formatPercentage(percentage, minDecimals = 0, maxDecimals = 2) {
    // Format the clamped percentage to include at least minDecimals and at most maxDecimals decimals
    const formattedPercentage = percentage.toLocaleString(undefined, {
        minimumFractionDigits: minDecimals,
        maximumFractionDigits: maxDecimals,
    });

    // Append '%' to indicate it's a percentage value
    return `${formattedPercentage}%`;
}

function formatTriggerMode(mode) {
    if (mode == 0) {
        return 'Bullish Bonding';
    } else if (mode == 1) {
        return 'God Mode';
    } else if (mode == 2) {
        return 'Moon Finder';
    } else if (mode == 3) {
        return 'PF Fomo';
    } else {
        return 'N/A';
    }
}

function formatDexscreenerPaid(mode) {
    if (mode === 0) {
        return 'IDC';
    } else if (mode === 1) {
        return '✅ Yes';
    } else if (mode === 2) {
        return '❌ No';
    } else {
        return 'N/A';
    }
}

function formatSOL(amount) {
    // Append '%' to indicate it's a percentage value
    return `${amount / 1e9} SOL`;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function emojiScore(num) {
    if (num == 1) {
        return '1️⃣';
    } else if (num == 2) {
        return '2️⃣';
    } else if (num == 3) {
        return '3️⃣';
    } else if (num == 4) {
        return '4️⃣';
    } else if (num == 5) {
        return '5️⃣';
    } else if (num == 6) {
        return '6️⃣';
    } else if (num == 7) {
        return '7️⃣';
    } else if (num == 8) {
        return '8️⃣';
    } else if (num == 9) {
        return '9️⃣';
    } else if (num == 10) {
        return '🔟';
    }

    return '0️⃣';
}

function isValidNumber(str) {
    return /^[+-]?\d+(\.\d+)?$/.test(str);
}

function getMultiplier(profitPercentage) {
    return Math.ceil(parseInt(profitPercentage) / 100) + 'x';
}

function getPercentageIncrease(totalSolReceived, totalSolSpent) {
    return ((totalSolReceived - totalSolSpent) * 100) / totalSolSpent;
}

function formatFiat(number) {
    return number.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function timeAgoFromUnixTimestamp(unixTimestamp, currentTime = null) {
    if (!currentTime) {
        currentTime = new Date().getTime() / 1000;
    }
    const diffInSeconds = currentTime - unixTimestamp;

    const intervals = {
        y: 31536000,
        mo: 2592000,
        w: 604800,
        d: 86400,
        h: 3600,
        m: 60,
    };

    for (const interval in intervals) {
        const value = Math.floor(diffInSeconds / intervals[interval]);
        if (value >= 1) {
            return `${value < 10 ? ' ' : ''}${value}${interval}`;
        }
    }

    return 'Now';
}

function getMinutesFromUnixTimestamp(unixTimestamp, currentTime = null) {
    if (!currentTime) {
        currentTime = new Date().getTime() / 1000;
    }
    const diffInSeconds = currentTime - unixTimestamp;

    const h = Math.floor(diffInSeconds / 3600);
    const m = Math.floor(diffInSeconds % 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
}

function buildWalletString(wallet) {
    const solLink = `<a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a>`;

    return `💳 <strong>${wallet.label ? `${wallet.label} (${solLink})` : solLink}</strong>`;
}

function buildConfirmationMsg(wallet, tokenAmount, solAmount, mcap, transaction, symbol, solPrice, direction = 'buy') {
    const solAmountFormatted = formatNumber(solAmount);
    const tokenAmountFormatted = formatNumber(tokenAmount, 0);
    const mcapFormatted = `MC: ${formatFiat(mcap)}`;
    const blockchainExplorerLink = buildBlockhainTxLink(transaction.signature);
    const solFiatAmount = solAmount * solPrice;
    const solFiatAmountFormatted = formatFiat(solFiatAmount);
    symbol = escapeTelegram(symbol);

    const triggerMode = transaction?.triggerMode;
    const triggerModeStr = triggerMode ? `${formatTriggerMode(triggerMode)}: ` : '';

    let msg = `${buildWalletString(wallet)}\n`;

    msg = `✅ ${triggerModeStr}Swapped <strong>${solAmountFormatted} SOL (${solFiatAmountFormatted})</strong> for <strong>${tokenAmountFormatted} ${symbol}</strong> @ <strong>${mcapFormatted}</strong>. ${blockchainExplorerLink}`;

    if (direction === 'sell') {
        msg = `✅ Swapped <strong>${tokenAmountFormatted} ${symbol}</strong> for <strong>${solAmountFormatted} SOL (${solFiatAmountFormatted})</strong> @ <strong>${mcapFormatted}</strong>. ${blockchainExplorerLink}`;
    }

    return msg;
}

function buildBlockhainTxLink(signature) {
    return `<a href="https://solscan.io/tx/${signature}">View on Solscan</a>`;
}

function formatNumber(input, fraction = 2) {
    const number = parseFloat(input);
    return number.toLocaleString('en-US', {
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
    });
}

function hasTokensLeft(tokensLeft) {
    return tokensLeft >= 1;
}

function calculatePositionStats(buyTx, pricePerToken, sellTxs = []) {
    const initialSol = buyTx.amountIn;
    const totalTokensSold = sellTxs.reduce((sum, tx) => sum + tx.amountIn, 0);
    const realizedSol = sellTxs.reduce((sum, tx) => sum + tx.amountOut, 0);
    const tokensLeft = buyTx.amountOut - totalTokensSold;
    const worthSol = tokensLeft * Number(pricePerToken);

    const isPositionOpen = hasTokensLeft(tokensLeft);
    const growthRate = isPositionOpen
        ? (worthSol / initialSol - 1) * 100
        : (realizedSol / initialSol - 1) * 100;

    const elapsed = isPositionOpen
        ? getMinutesFromUnixTimestamp(buyTx.timestamp)
        : getMinutesFromUnixTimestamp(buyTx.timestamp, sellTxs[sellTxs.length - 1]?.timestamp);

    const icon = isPositionOpen ? '🪙' : '🔒';

    return {
        initialSol,
        realizedSol,
        worthSol,
        tokensLeft,
        growthRate,
        elapsed,
        icon,
    };
}

function generatePositionRow(idx, buyTx, sellTxs, poolInfo) {
    const { icon, growthRate, elapsed } = calculatePositionStats(buyTx, poolInfo.poolObject.pricePerToken, sellTxs);

    let msg = `/${(idx + 1).toString().padEnd(4, ' ')} <strong>${icon} ${escapeTelegram(poolInfo.symbol)} 🚀 ${growthRate.toFixed(1)}% ⏰ ${elapsed}</strong>\n`;
    msg += `<code>${buyTx.tokenId}</code>\n`;

    return msg;
}

function escapeTelegram(message) {
    // Escape characters that Telegram uses for formatting
    const escapedMessage = message
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\|/g, '&#124;')
        .replace(/\./g, '.\u200b');

    return escapedMessage;
}

module.exports = { escapeTelegram, calculatePositionStats, generatePositionRow, hasTokensLeft, getMultiplier, getMinutesFromUnixTimestamp, getPercentageIncrease, isValidNumber, shortenAddress, truncateAddress, emojiScore, formatPercentage, formatTriggerMode, formatSOL, delay, formatDexscreenerPaid, formatFiat, timeAgoFromUnixTimestamp, buildWalletString, buildBlockhainTxLink, buildConfirmationMsg, formatNumber };