const bs58 = require('bs58').default;

const { verifyUserByTx, confirmFeeTx } = require('../utils/verify');
const { addWallet, getUserByTgId, updateWallet, getTransaction, getSellTransactions } = require('../utils/db');
const { buildInlineMsg, buildInlineButtons } = require('../utils/inlines');
const { checkBalance } = require('../utils/wallet');
const { ACTIVE_WALLETS_LIMIT } = require('../constants');
const { isValidNumber } = require('../utils/helper');
const { dispatchSellingSwap } = require('../utils/queues');
const { getPoolInfo } = require('../utils/api');
const { getUserState, clearUserState } = require('../utils/state');

async function handleMessageInput(bot, msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id;
    const msgId = msg.message_id;

    const state = await getUserState(chatId);
    const status = state.status ?? '';

    if (status === 'awaiting_verify_tx') {
        await handleVerifyTransaction(bot, chatId, text, userId);
    } else if (status === 'awaiting_payment_tx') {
        await handleFeeTransaction(bot, chatId, msgId, text, userId);
    } else if (status === 'awaiting_private_key') {
        await handlePrivateKey(bot, chatId, msgId, text, userId);
    } else if (status === 'awaiting_label'
        || status === 'awaiting_min_mcap'
        || status === 'awaiting_max_mcap'
        || status === 'awaiting_min_liquidity'
        || status === 'awaiting_max_liquidity'
        || status === 'awaiting_start_hour'
        || status === 'awaiting_end_hour'
        || status === 'awaiting_buy_amount'
        || status === 'awaiting_buy_slippage'
        || status === 'awaiting_sell_slippage'
        || status === 'awaiting_sell_preset1'
        || status === 'awaiting_sell_preset2'
        || status === 'awaiting_priority'
        || status === 'awaiting_deployer_age'
        || status === 'awaiting_ttc'
        || status === 'awaiting_mev_tip') {
        await handleUpdateState(bot, chatId, msgId, text, userId, status);
    } else if (status.startsWith('awaiting_custom_sell_')) {
        await handleCustomSell(bot, chatId, msgId, text, userId, status);
    }
}

// Function to handle text input
async function handleVerifyTransaction(bot, chatId, text, userId) {
    // Check if the transaction ID is valid
    let isValid = false;
    try {
        const decoded = bs58.decode(text);
        isValid = decoded.length == 64;
        // eslint-disable-next-line no-empty
    } catch { }

    if (!isValid) {
        bot.sendMessage(chatId, 'Transaction signature is not valid. Please try again!');
        return;
    }

    try {
        const state = await getUserState(chatId);
        const verifyAccount = state.verifyAccount;
        await verifyUserByTx(text, userId, verifyAccount);
        await clearUserState(chatId, 'status');

        const message = `🔑 <strong>Verification transaction received and confirmed!</strong>

Now continue to make payment to use this bot`;

        const options = {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Pay Now', callback_data: 'pay_fee' },
                    ],
                ],
            },
        };
        bot.sendMessage(chatId, message, options);
    } catch (ex) {
        console.log(ex);
        bot.sendMessage(chatId, 'Your verification transaction is not valid');
    }
}

async function handleFeeTransaction(bot, chatId, msgId, text, userId) {
    // Check if the transaction ID is valid
    let isValid = false;
    try {
        const decoded = bs58.decode(text);
        isValid = decoded.length == 64;
        // eslint-disable-next-line no-empty
    } catch { }

    if (!isValid) {
        bot.sendMessage(chatId, 'Transaction signature is not valid. Please try again!');
        return;
    }

    try {
        const user = await getUserByTgId(chatId, true);
        await confirmFeeTx(text, userId, user.verifyWallet);
        await clearUserState(chatId, 'status');

        if (user.wallets.length == 0) {
            const message = `🔑 <strong>Payment transaction received and confirmed!</strong>
    
    Ready to use our bot now.
    
    Import your wallet(s) to continue.`;

            const options = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📥 Import Wallet', callback_data: 'import_wallet' },
                        ],
                    ],
                },
            };
            bot.sendMessage(chatId, message, options);
        } else {
            const wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);
            handleResendStatus(bot, chatId, msgId, wallet, balance);
        }
    } catch (ex) {
        console.log(ex);
        bot.sendMessage(chatId, 'Your payment transaction is not valid');
    }
}

async function handlePrivateKey(bot, chatId, msgId, text, tgUserId) {
    let user = await getUserByTgId(chatId, true);

    try {
        const activeWallets = user.wallets.filter(w => w.isActive);
        if (activeWallets.length >= ACTIVE_WALLETS_LIMIT) {
            const wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);
            bot.sendMessage(chatId, `You cannot activate more than ${ACTIVE_WALLETS_LIMIT} wallets`,
                { parse_mode: 'HTML' }).then(() => {
                handleResendStatus(bot, chatId, msgId, wallet, balance);
            });
            return;
        }

        const walletPubKey = await addWallet(user.id, text);
        await clearUserState(chatId, 'status');

        user = await getUserByTgId(tgUserId, true);
        const wallet = user.wallets.find(t => t.isDefault);
        const balance = await checkBalance(wallet);

        const message = `Wallet <code>${walletPubKey}</code> successfully added to lawn mower!`;
        bot.sendMessage(chatId, message, { parse_mode: 'HTML' }).then(() => {
            handleResendStatus(bot, chatId, msgId, wallet, balance);
        });
    } catch (ex) {
        console.log(ex);
        bot.sendMessage(chatId, 'Get error while import wallet');
    }
}

async function handleUpdateState(bot, chatId, msgId, text, tgUserId, status) {
    let user = await getUserByTgId(chatId, true);
    let wallet = user.wallets.find(t => t.isDefault);
    const balance = await checkBalance(wallet);

    try {
        let val;
        if (status == 'awaiting_min_mcap'
            || status == 'awaiting_max_mcap'
            || status == 'awaiting_min_liquidity'
            || status == 'awaiting_max_liquidity'
            || status == 'awaiting_ttc'
            || status == 'awaiting_deployer_age') {
            val = parseInt(text) ?? 0;
            if (val < 0) {
                bot.sendMessage(chatId, 'Your input is not valid');
                return;
            }
        } else if (status == 'awaiting_start_hour'
            || status == 'awaiting_end_hour') {
            val = parseInt(text) ?? 0;
            if (val < 0 || val > 24) {
                bot.sendMessage(chatId, 'Your input is not valid');
                return;
            }
        } else if (status == 'awaiting_buy_amount') {
            val = parseFloat(text) ?? 0;
            if (val <= 0.001) {
                bot.sendMessage(chatId, 'Buy amount can\'t be less than 0.001 SOL');
                return;
            }
        } else if (status == 'awaiting_sell_percent') {
            val = parseFloat(text) ?? 0;
            console.log(val);
            if (val <= 0 || val > 100) {
                bot.sendMessage(chatId, 'Sell percentage is not valid');
                return;
            }
        } else if (status == 'awaiting_buy_slippage') {
            val = parseFloat(text) ?? 0;
            if (val < 0) {
                bot.sendMessage(chatId, 'Your input is not valid');
                return;
            }
        } else if (status == 'awaiting_sell_slippage') {
            val = parseFloat(text) ?? 0;
            if (val < 0) {
                bot.sendMessage(chatId, 'Your input is not valid');
                return;
            }
        } else if (status == 'awaiting_sell_preset1'
            || status == 'awaiting_sell_preset2'
        ) {
            val = parseInt(text) ?? 0;
            if (val <= 0 || val >= 100) {
                bot.sendMessage(chatId, 'Your input is not valid');
                return;
            }
        } else if (status == 'awaiting_priority') {
            val = Math.floor(1e9 * parseFloat(text) ?? 0);
            if (val >= 1e9) {
                bot.sendMessage(chatId, 'Priority fee can\'t be greater than 1 SOL');
                return;
            }
        } else if (status == 'awaiting_mev_tip') {
            val = Math.floor(1e9 * parseFloat(text) ?? 0);
            if (val >= 1e9) {
                bot.sendMessage(chatId, 'Tip amount can\'t be greater than 1 SOL');
                return;
            }
        } else {
            val = text;
        }

        let data = {};
        if (status == 'awaiting_min_mcap') {
            data = { minMcap: val };
        } else if (status == 'awaiting_max_mcap') {
            data = { maxMcap: val };
        } else if (status == 'awaiting_min_liquidity') {
            data = { minLiquidity: val };
        } else if (status == 'awaiting_max_liquidity') {
            data = { maxLiquidity: val };
        } else if (status == 'awaiting_deployer_age') {
            data = { deployerAge: val };
        } else if (status == 'awaiting_start_hour') {
            data = { startHour: val };
        } else if (status == 'awaiting_end_hour') {
            data = { endHour: val };
        } else if (status == 'awaiting_label') {
            data = { label: val };
        } else if (status == 'awaiting_buy_amount') {
            data = { buyAmount: val };
        } else if (status == 'awaiting_buy_slippage') {
            data = { buySlippage: val };
        } else if (status == 'awaiting_sell_slippage') {
            data = { sellSlippage: val };
        } else if (status == 'awaiting_priority') {
            data = { priorityFee: val };
        } else if (status == 'awaiting_mev_tip') {
            data = { tipMev: val };
        } else if (status == 'awaiting_sell_preset1') {
            data = { sellPreset1: val };
        } else if (status == 'awaiting_sell_preset2') {
            data = { sellPreset2: val };
        } else if (status == 'awaiting_ttc') {
            data = { ttc: val };
        }

        await updateWallet(wallet.id, data);
        await clearUserState(chatId, 'status');

        user = await getUserByTgId(tgUserId, true);
        wallet = user.wallets.find(t => t.isDefault);

        handleResendStatus(bot, chatId, msgId, wallet, balance);
    } catch (ex) {
        console.log(ex);
        bot.sendMessage(chatId, 'Get error while update wallet state').then(() => {
            handleResendStatus(bot, chatId, msgId, wallet, balance);
        });
    }
}

async function handleCustomSell(bot, chatId, msgId, text, tgUserId, status) {
    try {
        if (!isValidNumber(text)) {
            const message = 'Sell percent is not valid';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const sellPercent = Number(text);
        if (sellPercent <= 0 || sellPercent > 100) {
            const message = 'Sell percent is not in range';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const args = status.split('awaiting_custom_sell_')[1].split('_');
        if (args.length != 2) {
            const message = 'Status argument invalid';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const txId = parseInt(args[0]);
        msgId = args[1];
        const transaction = await getTransaction({
            id: txId,
        });
        if (!transaction) {
            const message = 'Not able to find transaction';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        if (transaction.wallet.user.telegramId != tgUserId) {
            const message = 'No transaction owned';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const poolInfo = await getPoolInfo(transaction.tokenId);
        if (!poolInfo) {
            const message = 'Unable to load pool info';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const sellTransactions = await getSellTransactions(txId);
        let totalSellAmount = 0;
        for (const sellTx of sellTransactions) {
            totalSellAmount += sellTx.amountIn;
        }

        const amount = (transaction.amountOut - totalSellAmount) * (sellPercent / 100);
        const swapArgs = {
            isBuy: false,
            amount,
            msgId,
            buyTxId: txId,
        };
        await dispatchSellingSwap(swapArgs, transaction.wallet, poolInfo);
        await clearUserState(chatId, 'status');
    } catch (ex) {
        console.log(ex);
        bot.sendMessage(chatId, 'Get error while execute sell');
    }
}

function handleResendStatus(bot, chatId, msgId, wallet, balance) {
    bot.deleteMessage(chatId, msgId).then(() => {

        const message = buildInlineMsg(wallet, balance);
        const inline_keyboard = buildInlineButtons(wallet);

        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard,
            },
            disable_web_page_preview: true,
        });

    });

}

module.exports = {
    handleMessageInput,
};
