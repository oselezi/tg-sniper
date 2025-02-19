/* eslint-disable */
const { Raydium } = require('@raydium-io/raydium-sdk-v2');
const { LAMPORTS_PER_SOL, Connection } = require('@solana/web3.js');
const { parseV4Transaction, buildV4Buy } = require('./utils/raydium');
const { connection } = require('./constants');
const { buildPfBuy, buildPfSell, parsePfTransaction } = require('./utils/router');
const { swap } = require('./utils/swap');
const { getPoolInfo } = require('./utils/api');
const { getWallet, getWalletsByCriteria } = require('./utils/db');
const { sendAndConfirmTransaction, createAndSendV0Tx } = require('./utils/transaction');

// (async () => {
//     await buildV4Buy(connection, wallet, poolId, mint, decimals, pricePerSol, solAmount);
// })();

(async () => {
    // const wallets = await getWalletsByCriteria({
    //     agScore: 4,
    //     mcap: 30000,
    //     liquidity: 1000,
    //     triggerMode: 2,
    //     deployerAge: 4,
    //     dexscreenerPaid: true,
    // });
    // console.log(wallets.length)

    const mint = "7UXta6gEdf9E6uHZxLQahjHGFoysM4cNfZBzT9Wmpump";
    const wallet = await getWallet(5);
    wallet.buySlippage = 100;
    console.log(wallet.signer.publicKey.toBase58())

    // Router Buy
    // {
    //     const tx = await buildPfBuy(connection, wallet, mint, 0.001);
    //     const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    //     signature = await createAndSendV0Tx(connection, latestBlockhash, wallet.signer, [], tx.instructions);
    // }

    // Router Sell
    // {
    //     const tx = await buildPfSell(connection, wallet, mint, 6, 1000, true);
    //     const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    //     signature = await createAndSendV0Tx(connection, latestBlockhash, wallet.signer, [], tx.instructions);
    // }

    // Parse Router transaction
    {
        const signature = "2h74bdQYoW3dGZjRDFRGkLWhZMSzY9wi1ArciTeEwJ7hGrtkbAor2UCQcvcnaMZZJoECe1FinnTXxamtLXs1UuKk";
        const tx = await parsePfTransaction(connection, signature, 6);
        console.log(tx);
    }


    // const pool = await getPoolInfo(mint);
    // console.log(pool);

    // await swap(wallet, pool, {
    //     isBuy: true,
    //     amount: 0.001
    // }, true);

    // await swap(wallet, pool, {
    //     isBuy: false,
    //     amount: 10000,
    //     msgId: 1,
    //     buyTxId: 66,
    // });
})();

// (async () => {
//     const tx = await parseV4Transaction(connection, '4Cww8Lm8FAv8dmyeXXzihJJgdxsGSnEfyV7skdsumv5pMc4NqNySTGcGgyTUy4fHwqhTzL33m2YsjDQcBC4TSkba', 6);
//     console.log(tx)
// })();