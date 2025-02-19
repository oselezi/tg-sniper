const { stakedConnection: connection } = require('../constants');
const { createAndSendV0Tx } = require('./transaction');
const { addTransaction, getSellTransactions, getTransaction } = require('./db');
const { buildPfBuy, buildPfSell, parsePfTransaction } = require('./router');
const { buildCpmmBuy, buildV4Buy, buildV4Sell, buildCpmmSell, parseV4Transaction, parseCpmmTransaction } = require('./raydium');
const { sendToJitoEngine } = require('./mev');
const { buildTradeButtons, buildTradeMsg } = require('./inlines');
const { buildConfirmationMsg, formatTriggerMode, hasTokensLeft } = require('./helper');
const { dispatchNotification } = require('../utils/queues');

async function buy(wallet, pool, args, attempt, maxAttempts) {
    const chatId = wallet.user.telegramId;
    const signer = wallet.signer;

    const { amount } = args;
    const { address: mint, symbol, poolObject } = pool;
    const { type: provider, poolAddress } = poolObject;

    const decimals = Number(pool.decimals);
    const supply = Number(pool.supply);
    const solPrice = Number(pool.solPrice);
    const pricePerSol = Number(poolObject.pricePerSol);

    try {
        // Build transaction based on provider type
        let tx;
        if (provider === 'RAYDIUM_V4') {
            tx = await buildV4Buy(connection, wallet, poolAddress, mint, decimals, pricePerSol, amount);
        } else if (provider === 'RAYDIUM_CPMM') {
            tx = await buildCpmmBuy(connection, wallet, poolAddress, mint, decimals, pricePerSol, amount);
        } else if (provider === 'PUMPFUN') {
            tx = await buildPfBuy(connection, wallet, mint, amount);
        } else {
            throw new Error(`Invalid swap method for provider ${provider}`);
        }

        // Fetch latest blockhash and sign transaction
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = latestBlockhash.blockhash;
        tx.feePayer = signer.publicKey;

        // Send the transaction
        let signature;
        if (wallet.isMev) {
            signature = await sendToJitoEngine(connection, wallet, tx);
        } else {
            signature = await createAndSendV0Tx(connection, latestBlockhash, signer, [], tx.instructions);
        }

        // Handle missing signature
        if (!signature) {
            throw new Error('Transaction failed to confirm: No signature returned.');
        }

        console.log('Transaction confirmed: ', signature);

        // Parse transaction details
        let ret;
        if (provider === 'RAYDIUM_V4') {
            ret = await parseV4Transaction(connection, signature, decimals);
        } else if (provider === 'RAYDIUM_CPMM') {
            ret = await parseCpmmTransaction(connection, signature, decimals);
        } else if (provider === 'PUMPFUN') {
            ret = await parsePfTransaction(connection, signature, decimals);
        }

        if (!ret) {
            throw new Error('Failed to parse confirmed transaction.');
        }

        const { solAmount, tokenAmount, slot, timestamp } = ret;
        const transaction = await addTransaction(wallet.id, signature, 'BUY', solAmount, tokenAmount, mint, poolAddress, timestamp, slot, null, wallet.triggerMode);
        const mcap = (solAmount / tokenAmount) * supply * solPrice;

        // Send success notifications
        const confirmationMsg = buildConfirmationMsg(wallet, tokenAmount, solAmount, mcap, transaction, symbol, solPrice, 'buy');
        await dispatchNotification(`buy:${wallet.address}:${mint}`, 'send-buy-confirmation', chatId, confirmationMsg, {
            parse_mode: 'HTML',
        });

        const message = await buildTradeMsg(wallet, transaction, pool);
        await dispatchNotification(`monitor:${wallet.address}:${mint}`, 'send-ping-monitor', chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: buildTradeButtons(transaction.id, wallet, true),
            },
        }, true);

        return signature;
    } catch (error) {
        const currentAttempt = attempt + 1;
        const errorMessage = `${formatTriggerMode(wallet.triggerMode)} Swap failed for <b>${symbol}</b> (Attempt ${currentAttempt} of ${maxAttempts}): ${error.message}`;
        await dispatchNotification(`buyFailed:${wallet.address}:${mint}:attempt${currentAttempt}`, 'send-buy-failed', chatId, errorMessage, {
            parse_mode: 'HTML',
        });

        // Throw error to let BullMQ handle retries
        console.error(`Error during buy operation for wallet ${wallet.address} (Attempt ${currentAttempt} of ${maxAttempts}):`, error.message);
        throw new Error(`Buy operation failed: ${error.message}`);
    }
}

async function sell(wallet, pool, args) {
    const chatId = wallet.user.telegramId;
    const signer = wallet.signer;

    const { amount, msgId, isClose, buyTxId } = args;
    const { address: mint, symbol, poolObject } = pool;
    const { type: provider, poolAddress } = poolObject;

    const decimals = Number(pool.decimals);
    const supply = Number(pool.supply);
    const solPrice = Number(pool.solPrice);
    const pricePerSol = Number(poolObject.pricePerSol);

    try {
        // Build transaction based on provider type
        let tx;
        if (provider === 'RAYDIUM_V4') {
            tx = await buildV4Sell(connection, wallet, poolAddress, mint, decimals, pricePerSol, amount, isClose);
        } else if (provider === 'RAYDIUM_CPMM') {
            tx = await buildCpmmSell(connection, wallet, poolAddress, mint, decimals, pricePerSol, amount, isClose);
        } else if (provider === 'PUMPFUN') {
            tx = await buildPfSell(connection, wallet, mint, decimals, amount, isClose);
        } else {
            throw new Error('Invalid swap method');
        }

        // Fetch latest blockhash and sign transaction
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = latestBlockhash.blockhash;
        tx.feePayer = signer.publicKey;

        // Send the transaction
        let signature;
        if (wallet.isMev) {
            signature = await sendToJitoEngine(connection, wallet, tx);
        } else {
            signature = await createAndSendV0Tx(connection, latestBlockhash, signer, [], tx.instructions);
        }

        // Handle missing signature
        if (!signature) {
            throw new Error('Transaction failed to confirm: No signature returned.');
        }

        console.log('Transaction confirmed: ', signature);

        // Fetch and parse transaction details
        let ret;
        if (provider === 'RAYDIUM_V4') {
            ret = await parseV4Transaction(connection, signature, decimals);
        } else if (provider === 'RAYDIUM_CPMM') {
            ret = await parseCpmmTransaction(connection, signature, decimals);
        } else if (provider === 'PUMPFUN') {
            ret = await parsePfTransaction(connection, signature, decimals);
        }

        if (!ret) {
            const failMessage = `Failed to verify transaction:
Tried to sell <b>${amount.toFixed(2)}</b> ${symbol}`;
            await dispatchNotification(`sellFailed:${wallet.address}:${mint}`, 'send-sell-failed', chatId, failMessage, {
                parse_mode: 'HTML',
            });
            return;
        }

        const { solAmount, tokenAmount, slot, timestamp } = ret;
        const swapMcap = (solAmount / tokenAmount) * supply * solPrice;
        const transaction = await addTransaction(wallet.id, signature, 'SELL', tokenAmount, solAmount, mint, poolAddress, timestamp, slot, buyTxId ?? null);

        // Send success notification
        const confirmationMsg = buildConfirmationMsg(wallet, tokenAmount, solAmount, swapMcap, transaction, symbol, solPrice, 'sell');
        await dispatchNotification(`sell:${wallet.address}:${mint}`, 'send-sell-confirmation', chatId, confirmationMsg, {
            parse_mode: 'HTML',
        });

        if (buyTxId) {
            // Calculate profit or performance metrics
            const buyingTx = await getTransaction({ id: buyTxId });
            const sellTransactions = await getSellTransactions(buyTxId);
            const totalTokensSold = sellTransactions.reduce((sum, sellTx) => sum + sellTx.amountIn, 0);
            const tokensLeft = buyingTx.amountOut - totalTokensSold;

            // Update trade monitor
            const message = await buildTradeMsg(wallet, buyingTx, pool, sellTransactions);
            await dispatchNotification(`edit:${wallet.address}:${mint}`, 'edit-trade-monitor', chatId, message, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: buildTradeButtons(buyingTx.id, wallet, hasTokensLeft(tokensLeft)),
                },
            }, false, msgId);
        }

        return signature;
    } catch (error) {
        // Send failure notification
        const errorMessage = `Swap failed for <b>${symbol}</b>: ${error.message}`;
        await dispatchNotification(`sellFailed:${wallet.address}:${mint}`, 'send-sell-failed', chatId, errorMessage, {
            parse_mode: 'HTML',
        });

        // Enabled when queueing this
        // // Log and propagate the error
        console.error(`Error during sell operation for wallet ${wallet.address}:`, error.message);
        throw new Error(`Sell operation failed: ${error.message}`);
    }
}

async function swap(wallet, pool, args, attempt = null, maxAttempts = null) {
    let tx;

    if (args.isBuy) {
        tx = await buy(wallet, pool, args, attempt, maxAttempts);
    } else {
        tx = await sell(wallet, pool, args);
    }

    return tx;
}

module.exports = { buy, sell, swap };