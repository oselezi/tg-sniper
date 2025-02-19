const fs = require('fs');

const { PublicKey } = require('@solana/web3.js');
const { ACTIVE_WALLETS_LIMIT, VERIFY_AMOUNT, connection, PAYMENT_AMOUNT, FEE_ADDRESS } = require('../constants');
const { getPoolInfo } = require('../utils/api');
const { drawCoinProfit } = require('../utils/canvas');
const { updateWallet, getUserByTgId, toggleDefaultWallet, getTransaction, getSellTransactions, getBuyTransactions } = require('../utils/db');
const { formatTriggerMode, emojiScore, isValidNumber, formatDexscreenerPaid, getPercentageIncrease, getMultiplier, generatePositionRow, formatPercentage, formatNumber, formatFiat, hasTokensLeft, escapeTelegram } = require('../utils/helper');
const { buildInlineButtons, buildInlineMsg, buildTradeButtons, buildTradeMsg } = require('../utils/inlines');
const { getVerifyAccount } = require('../utils/verify');
const { checkBalance } = require('../utils/wallet');
const { setUserState, clearUserState } = require('../utils/state');
const { dispatchSellingSwap } = require('../utils/queues');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { bs58 } = require('@coral-xyz/anchor/dist/cjs/utils/bytes');

require('dotenv').config();

// Handle callback queries
async function handleCallbackQuery(bot, query) {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data;
    let user = await getUserByTgId(chatId, true);

    if (data.startsWith('make_sell_')) {
        const args = data.split('make_sell_')[1].split('_');
        if (args.length != 2) {
            const message = 'Transaction arguments missing';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        if (!isValidNumber(args[0])
            || !isValidNumber(args[1])) {
            const message = 'Transaction arguments wrong';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const txId = Number(args[0]);
        const sellPercent = Number(args[1]);
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

        if (transaction.wallet.userId != user.id) {
            const message = 'No transaction owned';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const poolInfo = await getPoolInfo(transaction.tokenId);
        console.log('Trying to sell...', {
            poolInfo,
            transaction,
        });
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
    } else if (data.startsWith('custom_sell_')) {
        const args = data.split('custom_sell_')[1].split('_');
        if (!isValidNumber(args[0])) {
            const message = 'Transaction arguments wrong';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const txId = Number(args[0]);
        await setUserState(chatId, 'status', `awaiting_custom_sell_${txId}_${msgId}`);
        const message = 'Please enter custom sell percentage';

        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
        });
    } else if (data.startsWith('refresh_')) {
        const args = data.split('refresh_')[1].split('_');
        if (!isValidNumber(args[0])) {
            const message = 'Transaction arguments wrong';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const txId = Number(args[0]);
        const buyingTx = await getTransaction({
            id: txId,
        });
        const wallet = buyingTx.wallet;
        if (!buyingTx) {
            const message = 'Transaction not valid';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const sellTransactions = await getSellTransactions(txId);
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

        const message = await buildTradeMsg(wallet, buyingTx, poolInfo, sellTransactions);
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: buildTradeButtons(txId, wallet, hasTokensLeft(tokensLeft)),
            },
        });
    } else if (data.startsWith('flex_profit_')) {
        const isIncognito = data.startsWith('flex_profit_incognito_');
        const args = data.split(isIncognito ? 'flex_profit_incognito_' : 'flex_profit_')[1].split('_');
        if (!isValidNumber(args[0])) {
            const message = 'Transaction arguments wrong';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const txId = Number(args[0]);
        const transaction = await getTransaction({
            id: txId,
        });
        if (!transaction) {
            const message = 'Transaction not valid';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }

        const sellTransactions = await getSellTransactions(txId);
        let totalSellAmount = 0;
        let totalReceivedSol = 0;
        for (const sellTx of sellTransactions) {
            totalSellAmount += sellTx.amountIn;
            totalReceivedSol += sellTx.amountOut;
        }

        const poolInfo = await getPoolInfo(transaction.tokenId);
        console.log('Trying to flex...', {
            poolInfo,
            transaction,
        });
        if (!poolInfo) {
            const message = 'Unable to load pool info';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            return;
        }
        const solPrice = Number(poolInfo.solPrice);
        const price = Number(poolInfo.poolObject.pricePerToken);

        const initialSol = transaction.amountIn;
        const worthSol = (transaction.amountOut - totalSellAmount) * price;
        const realizedSol = totalReceivedSol;
        const returnedSol = worthSol + realizedSol;
        const profitPercent = getPercentageIncrease(returnedSol, initialSol);

        const username = query.message.chat.username || `${query.message.chat.first_name} ${query.message.chat.last_name}`;
        let profileImg = null;
        try {
            const photos = await bot.getUserProfilePhotos(chatId);
            if (photos.total_count > 0) {
                // Getting the first photo's file ID
                const fileId = photos.photos[0][0].file_id;
                const file = await bot.getFile(fileId);
                profileImg = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
            }
        } catch (error) {
            console.error('Error fetching profile photo:', error);
        }

        const image = await drawCoinProfit({
            symbol: poolInfo.symbol,
            totalInvestedSolAmount: `${formatNumber(initialSol, 3)} SOL`,
            totalReturnedSolAmount: `${formatNumber(returnedSol, 3)} SOL`,
            profitPercentage: `${formatPercentage(profitPercent, 0, 0)}`,
            profitUsdValue: `${(formatFiat((returnedSol - initialSol) * solPrice))}`,
            profitSolValue: `${formatNumber((returnedSol - initialSol), 2)} SOL`,
            multiplier: getMultiplier(profitPercent),
            username,
            profileImg,
        }, isIncognito);
        const imgStream = fs.createReadStream(image);
        bot.sendPhoto(chatId, imgStream, {}, {
            filename: image,
            contentType: 'application/octet-stream',
        });
    } else {
        switch (data) {
        case 'verify_step': {
            const verifyAccount = await getVerifyAccount();

            await setUserState(chatId, 'status', 'awaiting_verify_tx');
            await setUserState(chatId, 'verifyAccount', verifyAccount);

            const message = `🔑 To verify as a holder, please send ${VERIFY_AMOUNT} SOL this:

<code>${verifyAccount}</code>

<strong>VERY IMPORTANT: Send it from the wallet that holds your AG SOL NFT(s).</strong>
Once the transaction is confirmed, please send the transaction signature here.`;

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'pay_fee': {
            await setUserState(chatId, 'status', 'awaiting_payment_tx');

            const message = `🔑 To use this bot, please send ${PAYMENT_AMOUNT} SOL to this:

<code>${FEE_ADDRESS.toBase58()}</code>

<strong>VERY IMPORTANT: Send it from the wallet that holds your AG SOL NFT(s).</strong>
Once the transaction is confirmed, please send the transaction signature here.`;

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'import_wallet': {
            await setUserState(chatId, 'status', 'awaiting_private_key');
            const message = `🔐 Please send the private key of the wallet that you want to add.

We recommend generating a new wallet for this via Phantom or another sniper bot.`;

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'prev_wallet': {
            let curIdx = user.wallets.findIndex(t => t.isDefault);
            if (curIdx < 0) {
                curIdx = 0;
            }
            const prevIdx = (curIdx - 1 + user.wallets.length) % user.wallets.length;
            await toggleDefaultWallet(user.id, Number(user.wallets[prevIdx].id));

            user = await getUserByTgId(user.telegramId, true);
            const wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'next_wallet': {
            let curIdx = user.wallets.findIndex(t => t.isDefault);
            if (curIdx < 0) {
                // Handle the case where no default wallet is found
                curIdx = 0;
            }

            const nextIdx = (curIdx + 1) % user.wallets.length;

            await toggleDefaultWallet(user.id, Number(user.wallets[nextIdx].id));

            user = await getUserByTgId(user.telegramId, true);
            const wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'back_home': {
            const wallet = user.wallets.find(t => t.isDefault);
            await clearUserState(chatId, 'status');
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'positions_refresh': {
            let message = `👨‍🌾🤖 <strong>My positions</strong>

`;
            const transactions = await getBuyTransactions(user.id);
            for (let idx = 0; idx < transactions.length; idx++) {
                const { buyTx, sellTxs } = transactions[idx];
                const poolInfo = await getPoolInfo(buyTx.tokenId);
                message += generatePositionRow(idx, buyTx, sellTxs, poolInfo);
            }

            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Refresh', callback_data: 'positions_refresh' },
                        ],
                    ],
                },
            });
            break;
        }
        case 'set_label': {
            await setUserState(chatId, 'status', 'awaiting_label');
            const message = 'Please enter your wallet label';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'sell_all_token': {
            await clearUserState(chatId, 'status');
            // Get all tokens
            const wallet = user.wallets.find(t => t.isDefault);
            const pubkey = new PublicKey(wallet.address);
            const tokens = await connection.getTokenAccountsByOwner(
                pubkey,
                {
                    programId: TOKEN_PROGRAM_ID,
                },
                'confirmed',
            );

            const tokenData = [];
            tokens.value.map(token => {
                const { pubkey: ata, account } = token;
                const mint = bs58.encode(account.data.slice(0, 32));
                const balance = Number(account.data.readBigUInt64LE(64));
                tokenData.push({
                    ata,
                    mint,
                    balance,
                });
            });

            if (tokenData.length == 0) {
                bot.sendMessage(chatId,
                    'You don\'t have tokens to sell',
                    {
                        parse_mode: 'HTML',
                    });
                return;
            }

            let message = `Here is list for sell tokens.
Please confirm list and click button.\n
`;
            for (const token of tokenData) {
                const poolInfo = await getPoolInfo(token.mint);
                const decimals = poolInfo.decimals;
                const balance = token.balance / (10 ** decimals);
                message += `<strong>${escapeTelegram(poolInfo.symbol)}</strong>: ${balance.toFixed(2)}
`;
            }

            const options = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Confirm Sell', callback_data: 'confirm_sell_all' },
                        ],
                    ],
                },
            };
            bot.sendMessage(chatId, message, options);
            break;
        }
        case 'confirm_sell_all': {
            await clearUserState(chatId, 'status');
            // Get all tokens
            const wallet = user.wallets.find(t => t.isDefault);
            const pubkey = new PublicKey(wallet.address);
            const tokens = await connection.getTokenAccountsByOwner(
                pubkey,
                {
                    programId: TOKEN_PROGRAM_ID,
                },
                'confirmed',
            );

            for (const token of tokens.value) {
                const { account } = token;
                const mint = bs58.encode(account.data.slice(0, 32));
                const balance = Number(account.data.readBigUInt64LE(64)) / 1e6;
                if (balance > 0n) {
                    const poolInfo = await getPoolInfo(mint);
                    const swapArgs = {
                        isBuy: false,
                        isClose: true,
                        amount: balance,
                        msgId,
                    };
                    await dispatchSellingSwap(swapArgs, wallet, poolInfo);
                }
            }

            break;
        }
        case 'show_buy_setting': {
            await clearUserState(chatId, 'status');
            const message = 'You can update auto-buy setting';
            const wallet = user.wallets.find(t => t.isDefault);

            const options = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '← Back', callback_data: 'back_home' },
                        ],
                        [
                            { text: '✏️ 0.1 SOL', callback_data: 'choose_buy_amount_1' },
                            { text: '✏️ 0.5 SOL', callback_data: 'choose_buy_amount_5' },
                            { text: '✏️ 1 SOL', callback_data: 'choose_buy_amount_10' },
                        ],
                        [
                            { text: '✏️ 2 SOL', callback_data: 'choose_buy_amount_20' },
                            { text: '✏️ 5 SOL', callback_data: 'choose_buy_amount_50' },
                            { text: '✏️ 10 SOL', callback_data: 'choose_buy_amount_100' },
                        ],
                        [
                            { text: '✏️ Custom amount (SOL)', callback_data: 'set_buy_amount' },
                        ],
                        [
                            { text: `✏️ Auto-Buy Slippage (${wallet.buySlippage}%)`, callback_data: 'set_buy_slippage' },
                        ],
                    ],
                },
            };
            bot.sendMessage(chatId, message, options);
            break;
        }
        case 'show_sell_setting': {
            await clearUserState(chatId, 'status');
            const message = 'You can update sell setting';
            const wallet = user.wallets.find(t => t.isDefault);

            const options = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '← Back', callback_data: 'back_home' },
                        ],
                        [
                            { text: `✏️ Sell Preset1 (${wallet.sellPreset1}%)`, callback_data: 'set_sell_preset1' },
                            { text: `✏️ Sell Preset2 (${wallet.sellPreset2}%)`, callback_data: 'set_sell_preset2' },
                        ],
                        [
                            { text: `✏️ Sell Slippage (${wallet.sellSlippage}%)`, callback_data: 'set_sell_slippage' },
                        ],
                    ],
                },
            };
            bot.sendMessage(chatId, message, options);
            break;
        }
        case 'choose_buy_amount_1':
        case 'choose_buy_amount_5':
        case 'choose_buy_amount_10':
        case 'choose_buy_amount_20':
        case 'choose_buy_amount_50':
        case 'choose_buy_amount_100': {
            const buyAmount = parseInt(data.replace('choose_buy_amount_', '')) / 10;

            let wallet = user.wallets.find(t => t.isDefault);
            await updateWallet(wallet.id, { buyAmount });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'set_buy_amount': {
            await setUserState(chatId, 'status', 'awaiting_buy_amount');
            const message = 'Please enter your auto-buy amount (SOL)';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_buy_slippage': {
            await setUserState(chatId, 'status', 'awaiting_buy_slippage');
            const message = 'Please enter your slippage %';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_sell_slippage': {
            await setUserState(chatId, 'status', 'awaiting_sell_slippage');
            const message = 'Please enter your slippage %';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_sell_preset1': {
            await setUserState(chatId, 'status', 'awaiting_sell_preset1');
            const message = 'Please enter your sell percentage for preset #1';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_sell_preset2': {
            await setUserState(chatId, 'status', 'awaiting_sell_preset2');
            const message = 'Please enter your sell percentage for preset #2';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_min_mcap': {
            await setUserState(chatId, 'status', 'awaiting_min_mcap');
            const message = 'Please enter your min Mcap ($)';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_max_mcap': {
            await setUserState(chatId, 'status', 'awaiting_max_mcap');
            const message = 'Please enter your max Mcap ($)';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_min_liquidity': {
            await setUserState(chatId, 'status', 'awaiting_min_liquidity');
            const message = 'Please enter your min liquidity ($)';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_max_liquidity': {
            await setUserState(chatId, 'status', 'awaiting_max_liquidity');
            const message = 'Please enter your max liquidity ($)';
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_priority': {
            await setUserState(chatId, 'status', 'awaiting_priority');
            const message = 'Please enter your priority fee in SOL';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_deployer_age': {
            await setUserState(chatId, 'status', 'awaiting_deployer_age');
            const message = 'Please enter min\'s deployer age in hours';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'set_start_hour': {
            await setUserState(chatId, 'status', 'awaiting_start_hour');

            const wallet = user.wallets.find(t => t.isDefault);
            let message = '';
            if (wallet.startHour !== null) {
                message = `Current activated start time is ${wallet.startHour}:00 UTC

You can update or remove this field:
                        `;
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '❌ Remove', callback_data: 'remove_start_hour' },
                            ],
                        ],
                    },
                });
            } else {
                message = 'Please enter start hour in UTC:';
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                });
            }
            break;
        }
        case 'set_end_hour': {
            await setUserState(chatId, 'status', 'awaiting_end_hour');

            const wallet = user.wallets.find(t => t.isDefault);
            let message = '';
            if (wallet.endHour !== null) {
                message = `Current activated end time is ${wallet.endHour}:00 UTC

You can update or remove this field:
                        `;
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '❌ Remove', callback_data: 'remove_end_hour' },
                            ],
                        ],
                    },
                });
            } else {
                message = 'Please enter end hour in UTC:';
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                });
            }
            break;
        }
        case 'remove_start_hour': {
            let wallet = user.wallets.find(t => t.isDefault);
            await updateWallet(wallet.id, { startHour: null });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'remove_end_hour': {
            let wallet = user.wallets.find(t => t.isDefault);
            await updateWallet(wallet.id, { endHour: null });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'set_ttc': {
            await setUserState(chatId, 'status', 'awaiting_ttc');

            const wallet = user.wallets.find(t => t.isDefault);
            let message = '';
            if (wallet.ttc !== null) {
                message = `Current activated TTC is ${wallet.ttc}

You can update or remove this field:
                        `;
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '❌ Remove', callback_data: 'remove_ttc' },
                            ],
                        ],
                    },
                });
            } else {
                message = 'Please enter max time to completion (TTC) in seconds:';
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                });
            }
            break;
        }
        case 'remove_ttc': {
            let wallet = user.wallets.find(t => t.isDefault);
            await updateWallet(wallet.id, { ttc: null });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'set_trigger': {
            await setUserState(chatId, 'status', 'awaiting_trigger');
            const message = 'Please choose your trigger mode';

            const options = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: formatTriggerMode(0), callback_data: 'choose_trigger_0' },
                            { text: formatTriggerMode(1), callback_data: 'choose_trigger_1' },
                        ],
                        [
                            { text: formatTriggerMode(2), callback_data: 'choose_trigger_2' },
                            { text: formatTriggerMode(3), callback_data: 'choose_trigger_3' },
                        ],
                    ],
                },
            };
            bot.sendMessage(chatId, message, options);
            break;
        }
        case 'choose_trigger_0':
        case 'choose_trigger_1':
        case 'choose_trigger_2':
        case 'choose_trigger_3': {
            const triggerMode = parseInt(data.replace('choose_trigger_', ''));

            let wallet = user.wallets.find(t => t.isDefault);
            await updateWallet(wallet.id, { triggerMode });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'set_ag_score': {
            await setUserState(chatId, 'status', 'awaiting_score');
            const message = 'Please choose your min AG score';

            const options = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: emojiScore(0), callback_data: 'choose_ag_score_0' },
                            { text: emojiScore(1), callback_data: 'choose_ag_score_1' },
                            { text: emojiScore(2), callback_data: 'choose_ag_score_2' },
                            { text: emojiScore(3), callback_data: 'choose_ag_score_3' },
                        ],
                        [
                            { text: emojiScore(4), callback_data: 'choose_ag_score_4' },
                            { text: emojiScore(5), callback_data: 'choose_ag_score_5' },
                            { text: emojiScore(6), callback_data: 'choose_ag_score_6' },
                            { text: emojiScore(7), callback_data: 'choose_ag_score_7' },
                        ],
                        [
                            { text: emojiScore(8), callback_data: 'choose_ag_score_8' },
                            { text: emojiScore(9), callback_data: 'choose_ag_score_9' },
                            { text: emojiScore(10), callback_data: 'choose_ag_score_10' },
                        ],
                    ],
                },
            };
            bot.sendMessage(chatId, message, options);
            break;
        }
        case 'choose_ag_score_0':
        case 'choose_ag_score_1':
        case 'choose_ag_score_2':
        case 'choose_ag_score_3':
        case 'choose_ag_score_4':
        case 'choose_ag_score_5':
        case 'choose_ag_score_6':
        case 'choose_ag_score_7':
        case 'choose_ag_score_8':
        case 'choose_ag_score_9':
        case 'choose_ag_score_10': {
            const agScore = parseInt(data.replace('choose_ag_score_', ''));

            let wallet = user.wallets.find(t => t.isDefault);
            await updateWallet(wallet.id, { agScore });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'set_dexscreener_paid': {
            await setUserState(chatId, 'status', 'awaiting_dexscreener_paid');
            const message = 'Please choose your Dexscreener Paid';

            const options = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: formatDexscreenerPaid(1), callback_data: 'choose_dexscreener_1' },
                            { text: formatDexscreenerPaid(2), callback_data: 'choose_dexscreener_2' },
                        ],
                        [
                            { text: formatDexscreenerPaid(0), callback_data: 'choose_dexscreener_0' },
                        ],
                    ],
                },
            };
            bot.sendMessage(chatId, message, options);
            break;
        }
        case 'choose_dexscreener_0':
        case 'choose_dexscreener_1':
        case 'choose_dexscreener_2': {
            let wallet = user.wallets.find(t => t.isDefault);

            const input = parseInt(data.replace('choose_dexscreener_', ''));
            if (input == 0) {
                await updateWallet(wallet.id, { dexscreenerPaid: 0 });
            } else if (input == 1) {
                await updateWallet(wallet.id, { dexscreenerPaid: 1 });
            } else if (input == 2) {
                await updateWallet(wallet.id, { dexscreenerPaid: 2 });
            }

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'set_mev_tip': {
            await setUserState(chatId, 'status', 'awaiting_mev_tip');
            const message = 'Please enter your tip amount in SOL for Jito block engine (recommended at least 0.01)';

            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            break;
        }
        case 'toggle_mev': {
            let wallet = user.wallets.find(t => t.isDefault);
            await updateWallet(wallet.id, { isMev: !wallet.isMev });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        case 'toggle_status': {
            let wallet = user.wallets.find(t => t.isDefault);
            if (!wallet.isActive) {
                const activeWallets = user.wallets.filter(t => t.isActive);
                if (activeWallets.length >= ACTIVE_WALLETS_LIMIT) {
                    bot.sendMessage(chatId, `You can't activate more than ${ACTIVE_WALLETS_LIMIT} wallets.`);
                    break;
                }
            }

            await updateWallet(wallet.id, { isActive: !wallet.isActive });

            user = await getUserByTgId(user.telegramId, true);
            wallet = user.wallets.find(t => t.isDefault);
            const balance = await checkBalance(wallet);

            handleUpdateMessage(bot, chatId, msgId, wallet, balance);
            break;
        }
        // Add more cases as needed
        default:
            bot.sendMessage(chatId, 'Unknown callback data received.');
            break;
        }
    }
}

function handleUpdateMessage(bot, chatId, msgId, wallet, balance) {
    bot.editMessageText(buildInlineMsg(wallet, balance), {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: buildInlineButtons(wallet),
        },
    });
}
// Export callback query handler function
module.exports = {
    handleCallbackQuery,
};
