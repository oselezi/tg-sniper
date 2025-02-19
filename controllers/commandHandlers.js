const { getPoolInfo } = require('../utils/api');
const { getUserByTgId, getBuyTransactions, getTransactionByPosition, getSellTransactions, getVerifiedCount } = require('../utils/db');
const { generatePositionRow, hasTokensLeft } = require('../utils/helper');
const { buildInlineButtons, buildInlineMsg, buildTradeMsg, buildTradeButtons } = require('../utils/inlines');
const { checkBalance } = require('../utils/wallet');
const { clearUserState } = require('../utils/state');
const { MAX_USERS_LIMIT } = require('../constants');

// Handle /start command
async function handleStartCommand(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userObject = await getUserByTgId(userId, true);

    await clearUserState(chatId);

    let message = '';
    let inline_keyboard;

    if (userObject && userObject.verified && userObject.isPaid) {
        // Check if wallet exists
        if (userObject.wallets.length > 0) {
            // user verified and wallet(s) imported, so show the wallet management
            const wallet = userObject.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            message = buildInlineMsg(wallet, balance);

            inline_keyboard = buildInlineButtons(wallet);

        } else {
            message = 'User verified but no wallet exists. ';
            inline_keyboard = [
                [
                    { text: '📥 Import Wallet', callback_data: 'import_wallet' },
                ],
            ];
        }
    } else {
        // Check users limit
        const verifiedUsersCount = await getVerifiedCount();
        if (verifiedUsersCount >= MAX_USERS_LIMIT) {
            message = `Active users limit reached.
Please contact us later once limit increased.
`;

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        if (userObject && userObject.verified) {
            message = `👨‍🌾🤖 <strong>Welcome to AG Sniper Bot!</strong>

You have verified AG ownership and continue to make payment to use this bot.`;
            inline_keyboard = [
                [
                    { text: '✅ Pay Now', callback_data: 'pay_fee' },
                ],
            ];
        } else {
            message = `👨‍🌾🤖 <strong>Welcome to AG Sniper Bot!</strong>

You can add up to five wallets to automatically buy the hottest AG role ping or alert.

To use this bot, you must first verify as a holder.

Please click the button below to get started.`;
            inline_keyboard = [
                [
                    { text: '✅ Verify Now', callback_data: 'verify_step' },
                ],
            ];
        }
    }

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard,
        },
        disable_web_page_preview: true,
    };
    bot.sendMessage(chatId, message, options);
}

// Handle /positions command
async function handlePositionsCommand(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userObject = await getUserByTgId(userId, true);
    if (!userObject) {
        const failedMsg = 'Please verify first via /start';
        bot.sendMessage(chatId, failedMsg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
        return;
    }
    if (!userObject.isPaid) {
        const failedMsg = 'Please make fee transfer first via /start';
        bot.sendMessage(chatId, failedMsg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
        return;
    }

    let message = `👨‍🌾🤖 <strong>My positions</strong>

`;
    const transactions = await getBuyTransactions(userObject.id);
    for (let idx = 0; idx < transactions.length; idx++) {
        const { buyTx, sellTxs } = transactions[idx];
        const poolInfo = await getPoolInfo(buyTx.tokenId);
        message += generatePositionRow(idx, buyTx, sellTxs, poolInfo);
    }

    const inline_keyboard = [
        [
            { text: '🔄 Refresh', callback_data: 'positions_refresh' },
        ],
    ];

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard,
        },
        disable_web_page_preview: true,
    };
    bot.sendMessage(chatId, message, options);
}

// Handle /position command
async function handlePositionCommand(bot, msg) {

    const positionNo = Number(msg.text.split('/')[1]);
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userObject = await getUserByTgId(userId, true);
    if (!userObject) {
        const failedMsg = 'Please verify first via /start';
        bot.sendMessage(chatId, failedMsg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
        return;
    }
    if (!userObject.isPaid) {
        const failedMsg = 'Please make fee transfer first via /start';
        bot.sendMessage(chatId, failedMsg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
        return;
    }

    const buyingTx = await getTransactionByPosition(userObject.id, positionNo);
    if (!buyingTx) {
        bot.sendMessage(chatId, 'No position exists');
        return;
    }

    const sellTransactions = await getSellTransactions(buyingTx.id);
    const totalTokensSold = sellTransactions.reduce((sum, sellTx) => sum + sellTx.amountIn, 0);
    const tokensLeft = buyingTx.amountOut - totalTokensSold;

    const poolInfo = await getPoolInfo(buyingTx.tokenId);
    console.log('Trying to refresh...', {
        poolInfo,
        buyingTx,
    });
    if (!poolInfo) {
        const message = 'Unable to load pool info';
        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
        });
        return;
    }

    const message = await buildTradeMsg(buyingTx.wallet, buyingTx, poolInfo, sellTransactions);
    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: buildTradeButtons(buyingTx.id, buyingTx.wallet, hasTokensLeft(tokensLeft)),
        },
        disable_web_page_preview: true,
    };
    bot.sendMessage(chatId, message, options);
}

// Export command handlers
module.exports = {
    handleStartCommand,
    handlePositionsCommand,
    handlePositionCommand,
    // Add more command handlers as needed
};
