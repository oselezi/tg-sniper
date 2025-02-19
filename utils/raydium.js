const { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');
const { getAssociatedTokenAddressSync, getAccount, createAssociatedTokenAccountInstruction, NATIVE_MINT, createCloseAccountInstruction, createSyncNativeInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58').default;

const { FEE_PERCENTAGE, SOL_MINT, RAYDIUM_V4_PROGRAM_ID, RAYDIUM_CPMM_PROGRAM_ID } = require('../constants');
const { getFeeTransferIx, getComputePriorityIx, fetchTransaction } = require('./transaction');
const { Raydium, makeAMMSwapInstruction, makeSwapCpmmBaseInInInstruction, getPdaObservationId } = require('@raydium-io/raydium-sdk-v2');
const { getDiscriminator, compareUintArray } = require('./parser');

const SWAP_BASE_INPUT_DISC = getDiscriminator('swap_base_input');

async function initRaydium(connection, signer) {
    const raydium = await Raydium.load({
        connection,
        cluster: 'mainnet',
        owner: signer,
    });

    return raydium;
}

async function buildV4Buy(connection, wallet, poolId, mint, decimals, pricePerSol, solAmount) {
    const signer = wallet.signer;
    const client = await initRaydium(connection, signer);
    const poolKeys = await client.api.fetchPoolKeysById({
        idList: [poolId],
    });
    if (poolKeys.length == 0) {
        throw new Error('Pool not exists');
    }
    const poolKey = poolKeys[0];

    // Not need because we get the same value via payload
    // const poolInfos = await client.api.fetchPoolById({
    //     ids: poolId,
    // });
    // if (poolInfos.length == 0) {
    //     throw new Error('PoolInfo not exists');
    // }
    // const poolInfo = poolInfos[0];

    console.log('Logged Pool Info from Raydium API', {
        poolKeys,
    });

    const solAmount_ = Math.floor(solAmount * LAMPORTS_PER_SOL);
    const feeAmount = Math.floor(solAmount_ * FEE_PERCENTAGE);
    const solAmountIn = solAmount_ - feeAmount;
    const minTokenOut = Math.floor(solAmountIn * (pricePerSol / (10 ** (9 - decimals))) * (1 - (wallet.buySlippage / 100)));
    console.log(`price: ${pricePerSol}, solIn: ${solAmountIn / LAMPORTS_PER_SOL}, tokenOutMin: ${minTokenOut / (10 ** decimals)}`);

    const mint_ = new PublicKey(mint);
    const associatedWsol = getAssociatedTokenAddressSync(NATIVE_MINT, signer.publicKey);
    const associatedUser = getAssociatedTokenAddressSync(mint_, signer.publicKey);

    const prevIxs = [
        getComputePriorityIx(wallet.priorityFee),
    ];

    // Create Wrapped SOL account
    prevIxs.push(
        createAssociatedTokenAccountInstruction(signer.publicKey, associatedWsol, signer.publicKey, NATIVE_MINT),
        SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: associatedWsol,
            lamports: solAmountIn,
        }),
        createSyncNativeInstruction(associatedWsol),
    );

    // Check if user ata exists
    let userAtaExists = false;
    try {
        const userAta = await getAccount(connection, associatedUser, 'confirmed');
        if (userAta.owner.toBase58() == signer.publicKey.toBase58()
            && userAta.mint.toBase58() == mint) {
            userAtaExists = true;
        }
    } catch (ex) {
        // console.log(ex);
    }
    if (!userAtaExists) {
        prevIxs.push(
            createAssociatedTokenAccountInstruction(signer.publicKey, associatedUser, signer.publicKey, mint_),
        );
    }

    const amountIn = new BN(solAmountIn);
    const amountOut = new BN(minTokenOut);

    const swapIx = makeAMMSwapInstruction({
        version: 4,
        poolKeys: poolKey,
        userKeys: {
            tokenAccountIn: associatedWsol,
            tokenAccountOut: associatedUser,
            owner: signer.publicKey,
        },
        amountIn,
        amountOut,
        fixedSide: 'in',
    });

    const postIxs = [
        createCloseAccountInstruction(associatedWsol, signer.publicKey, signer.publicKey),
        getFeeTransferIx(signer.publicKey, NATIVE_MINT, feeAmount, 9),
    ];

    const ixs = [...prevIxs, swapIx, ...postIxs];
    const tx = new Transaction();
    tx.instructions = ixs;
    return tx;
}

async function buildV4Sell(connection, wallet, poolId, mint, decimals, pricePerSol, tokenAmount, isClose) {
    const signer = wallet.signer;
    const client = await initRaydium(connection, signer);
    const poolKeys = await client.api.fetchPoolKeysById({
        idList: [poolId],
    });
    if (poolKeys.length == 0) {
        throw new Error('PoolKeys not exists');
    }
    const poolKey = poolKeys[0];

    // const poolInfos = await client.api.fetchPoolById({
    //     ids: poolId,
    // });
    // if (poolInfos.length == 0) {
    //     throw new Error('PoolInfo not exists');
    // }
    // const poolInfo = poolInfos[0];

    const tokenAmountIn = tokenAmount * (10 ** decimals);
    const solCost = tokenAmountIn / (pricePerSol / (10 ** (9 - decimals)));
    const solOutMin = Math.floor(solCost * (1 - (wallet.sellSlippage / 100)));
    const feeAmount = Math.floor(solCost * FEE_PERCENTAGE);
    console.log('Building buildV4Sell', {
        wallet: wallet.address,
        mint,
        pricePerSol,
        solOutMin: solOutMin / LAMPORTS_PER_SOL,
        tokenAmount,
    });

    const mint_ = new PublicKey(mint);
    const associatedWsol = getAssociatedTokenAddressSync(NATIVE_MINT, signer.publicKey);
    const associatedUser = getAssociatedTokenAddressSync(mint_, signer.publicKey);

    const prevIxs = [
        getComputePriorityIx(wallet.priorityFee),
    ];

    // Create Wrapped SOL account
    prevIxs.push(
        createAssociatedTokenAccountInstruction(signer.publicKey, associatedWsol, signer.publicKey, NATIVE_MINT),
    );

    // Check if user ata exists
    let userAtaExists = false;
    try {
        const userAta = await getAccount(connection, associatedUser, 'confirmed');
        if (userAta.owner.toBase58() == signer.publicKey.toBase58()
            && userAta.mint.toBase58() == mint) {
            userAtaExists = true;
        }
    } catch (ex) {
        // console.log(ex);
    }

    if (!userAtaExists) {
        prevIxs.push(
            createAssociatedTokenAccountInstruction(signer.publicKey, associatedUser, signer.publicKey, mint_),
        );
    }

    const amountIn = new BN(tokenAmountIn);
    const amountOut = new BN(solOutMin);

    const swapIx = makeAMMSwapInstruction({
        version: 4,
        poolKeys: poolKey,
        userKeys: {
            tokenAccountIn: associatedUser,
            tokenAccountOut: associatedWsol,
            owner: signer.publicKey,
        },
        amountIn,
        amountOut,
        fixedSide: 'in',
    });

    const postIxs = [
        createCloseAccountInstruction(associatedWsol, signer.publicKey, signer.publicKey),
        getFeeTransferIx(signer.publicKey, NATIVE_MINT, feeAmount, 9),
    ];
    if (isClose) {
        postIxs.push(
            createCloseAccountInstruction(associatedUser, signer.publicKey, signer.publicKey),
        );
    }

    const ixs = [...prevIxs, swapIx, ...postIxs];
    const tx = new Transaction();
    tx.instructions = ixs;
    return tx;
}

async function buildCpmmBuy(connection, wallet, poolId, mint, decimals, pricePerSol, solAmount) {
    const signer = wallet.signer;
    const client = await initRaydium(connection, signer);
    const poolKeys = await client.api.fetchPoolKeysById({
        idList: [poolId],
    });
    if (poolKeys.length == 0) {
        throw new Error('Pool not exists');
    }
    const poolKey = poolKeys[0];

    // const poolInfos = await client.api.fetchPoolById({
    //     ids: poolId,
    // });
    // if (poolInfos.length == 0) {
    //     throw new Error('PoolInfo not exists');
    // }
    // const poolInfo = poolInfos[0];

    const solAmount_ = Math.floor(solAmount * LAMPORTS_PER_SOL);
    const feeAmount = Math.floor(solAmount_ * FEE_PERCENTAGE);
    const solAmountIn = solAmount_ - feeAmount;
    const minTokenOut = Math.floor(solAmountIn * (pricePerSol / (10 ** (9 - decimals))) * (1 - (wallet.buySlippage / 100)));
    console.log(`price: ${pricePerSol}, solIn: ${solAmountIn / LAMPORTS_PER_SOL}, tokenOutMin: ${minTokenOut / (10 ** decimals)}`);

    const mint_ = new PublicKey(mint);
    const associatedWsol = getAssociatedTokenAddressSync(NATIVE_MINT, signer.publicKey);
    const associatedUser = getAssociatedTokenAddressSync(mint_, signer.publicKey);

    const prevIxs = [
        getComputePriorityIx(wallet.priorityFee),
    ];

    // Create Wrapped SOL account
    prevIxs.push(
        createAssociatedTokenAccountInstruction(signer.publicKey, associatedWsol, signer.publicKey, NATIVE_MINT),
        SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: associatedWsol,
            lamports: solAmountIn,
        }),
        createSyncNativeInstruction(associatedWsol),
    );

    // Check if user ata exists
    let userAtaExists = false;
    try {
        const userAta = await getAccount(connection, associatedUser, 'confirmed');
        if (userAta.owner.toBase58() == signer.publicKey.toBase58()
            && userAta.mint.toBase58() == mint) {
            userAtaExists = true;
        }
    } catch (ex) {
        // console.log(ex);
    }
    if (!userAtaExists) {
        prevIxs.push(
            createAssociatedTokenAccountInstruction(signer.publicKey, associatedUser, signer.publicKey, mint_),
        );
    }

    const amountIn = new BN(solAmountIn);
    const amountOut = new BN(minTokenOut);
    const observationId = getPdaObservationId(RAYDIUM_CPMM_PROGRAM_ID, new PublicKey(poolId)).publicKey;

    const swapIx = makeSwapCpmmBaseInInInstruction(
        RAYDIUM_CPMM_PROGRAM_ID,
        signer.publicKey,
        new PublicKey(poolKey.authority),
        new PublicKey(poolKey.config.id),
        new PublicKey(poolId),
        associatedWsol,
        associatedUser,
        new PublicKey(poolKey.vault.A),
        new PublicKey(poolKey.vault.B),
        TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        NATIVE_MINT,
        mint_,
        observationId,
        amountIn,
        amountOut,
    );

    const postIxs = [
        createCloseAccountInstruction(associatedWsol, signer.publicKey, signer.publicKey),
        getFeeTransferIx(signer.publicKey, NATIVE_MINT, feeAmount, 9),
    ];

    const ixs = [...prevIxs, swapIx, ...postIxs];
    const tx = new Transaction();
    tx.instructions = ixs;
    return tx;
}

async function buildCpmmSell(connection, wallet, poolId, mint, decimals, pricePerSol, tokenAmount, isClose) {
    const signer = wallet.signer;
    const client = await initRaydium(connection, signer);
    const poolKeys = await client.api.fetchPoolKeysById({
        idList: [poolId],
    });
    if (poolKeys.length == 0) {
        throw new Error('PoolKeys not exists');
    }
    const poolKey = poolKeys[0];

    // const poolInfos = await client.api.fetchPoolById({
    //     ids: poolId,
    // });
    // if (poolInfos.length == 0) {
    //     throw new Error('PoolInfo not exists');
    // }
    // const poolInfo = poolInfos[0];

    const tokenAmountIn = Math.floor(tokenAmount * (10 ** decimals));
    const solCost = tokenAmountIn / (pricePerSol / (10 ** (9 - decimals)));
    const solOutMin = Math.floor(solCost * (1 - (wallet.sellSlippage / 100)));
    const feeAmount = Math.floor(solCost * FEE_PERCENTAGE);
    console.log('Building buildCpmmSell', {
        wallet: wallet.address,
        mint,
        pricePerSol,
        solOutMin: solOutMin / LAMPORTS_PER_SOL,
        tokenAmount,
    });

    const mint_ = new PublicKey(mint);
    const associatedWsol = getAssociatedTokenAddressSync(NATIVE_MINT, signer.publicKey);
    const associatedUser = getAssociatedTokenAddressSync(mint_, signer.publicKey);

    const prevIxs = [
        getComputePriorityIx(wallet.priorityFee),
    ];

    // Create Wrapped SOL account
    prevIxs.push(
        createAssociatedTokenAccountInstruction(signer.publicKey, associatedWsol, signer.publicKey, NATIVE_MINT),
    );

    // Check if user ata exists
    let userAtaExists = false;
    try {
        const userAta = await getAccount(connection, associatedUser, 'confirmed');
        if (userAta.owner.toBase58() == signer.publicKey.toBase58()
            && userAta.mint.toBase58() == mint) {
            userAtaExists = true;
        }
    } catch (ex) {
        // console.log(ex);
    }

    if (!userAtaExists) {
        prevIxs.push(
            createAssociatedTokenAccountInstruction(signer.publicKey, associatedUser, signer.publicKey, mint_),
        );
    }

    const amountIn = new BN(tokenAmountIn);
    const amountOut = new BN(solOutMin);
    const observationId = getPdaObservationId(RAYDIUM_CPMM_PROGRAM_ID, new PublicKey(poolId)).publicKey;

    const swapIx = makeSwapCpmmBaseInInInstruction(
        RAYDIUM_CPMM_PROGRAM_ID,
        signer.publicKey,
        new PublicKey(poolKey.authority),
        new PublicKey(poolKey.config.id),
        new PublicKey(poolId),
        associatedUser,
        associatedWsol,
        new PublicKey(poolKey.vault.B),
        new PublicKey(poolKey.vault.A),
        TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mint_,
        NATIVE_MINT,
        observationId,
        amountIn,
        amountOut,
    );

    const postIxs = [
        createCloseAccountInstruction(associatedWsol, signer.publicKey, signer.publicKey),
        getFeeTransferIx(signer.publicKey, NATIVE_MINT, feeAmount, 9),
    ];
    if (isClose) {
        postIxs.push(
            createCloseAccountInstruction(associatedUser, signer.publicKey, signer.publicKey),
        );
    }

    const ixs = [...prevIxs, swapIx, ...postIxs];
    const tx = new Transaction();
    tx.instructions = ixs;
    return tx;
}

async function parseV4Transaction(connection, signature, decimals) {

    try {
        const tx = await fetchTransaction(connection, signature);
        if (!tx) {
            throw Error('Fetch transaction failed');
        }

        const { meta, slot, transaction, blockTime: timestamp } = tx;
        const instructions = transaction.message.instructions;
        const innerInstructions = meta.innerInstructions;

        const signer = transaction.message.accountKeys.find(t => t.signer).pubkey;

        // Loop main instructions for RayRouter
        for (let i = 0; i < instructions.length; i++) {
            const { programId, data } = instructions[i];
            if (!data || programId != RAYDIUM_V4_PROGRAM_ID.toBase58()) {
                continue;
            }

            const args = bs58.decode(data.toString());
            if (args[0] != 9 && args[0] != 11) {
                continue;
            }

            // Next two instructions are token in/out
            const innerIxs = innerInstructions.filter(t => t.index == i)[0].instructions;
            const inIx = innerIxs[0];
            const outIx = innerIxs[1];
            const srcAmount = BigInt(inIx.parsed.info.amount ?? inIx.parsed.info.tokenAmount.amount);
            const dstAmount = BigInt(outIx.parsed.info.amount ?? outIx.parsed.info.tokenAmount.amount);

            const associatedWsol = getAssociatedTokenAddressSync(NATIVE_MINT, signer).toBase58();
            const isIn = inIx.parsed.info.destination == associatedWsol;

            const solAmount_ = Number(isIn ? srcAmount : dstAmount) / LAMPORTS_PER_SOL;
            const tokenAmount_ = Number(!isIn ? srcAmount : dstAmount) / (10 ** decimals);

            return {
                solAmount: solAmount_,
                tokenAmount: tokenAmount_,
                slot,
                timestamp: Number(timestamp),
            };
        }

        // eslint-disable-next-line no-empty
    } catch (e) {
        console.log(e);
    }
}

async function parseCpmmTransaction(connection, signature, decimals) {

    try {
        const tx = await fetchTransaction(connection, signature);
        if (!tx) {
            throw Error('Fetch transaction failed');
        }

        const { meta, slot, transaction, blockTime: timestamp } = tx;
        const instructions = transaction.message.instructions;
        const innerInstructions = meta.innerInstructions;

        // Loop main instructions for RayRouter
        for (let i = 0; i < instructions.length; i++) {
            const { programId, data, accounts } = instructions[i];
            if (!data || programId != RAYDIUM_CPMM_PROGRAM_ID.toBase58()) {
                continue;
            }

            const args = bs58.decode(data.toString());
            const discriminator = args.subarray(0, 8);
            if (!compareUintArray(discriminator, SWAP_BASE_INPUT_DISC)) {
                continue;
            }

            // Consider optional account
            const srcMint = accounts[10];

            // Next two instructions are token in/out
            const innerIxs = innerInstructions.filter(t => t.index == i)[0].instructions;
            const inIx = innerIxs[0];
            const outIx = innerIxs[1];
            const srcAmount = BigInt(inIx.parsed.info.amount ?? inIx.parsed.info.tokenAmount.amount);
            const dstAmount = BigInt(outIx.parsed.info.amount ?? outIx.parsed.info.tokenAmount.amount);

            const isIn = srcMint == SOL_MINT;
            const solAmount_ = Number(isIn ? srcAmount : dstAmount) / LAMPORTS_PER_SOL;
            const tokenAmount_ = Number(!isIn ? srcAmount : dstAmount) / (10 ** decimals);

            return {
                solAmount: solAmount_,
                tokenAmount: tokenAmount_,
                slot,
                timestamp: Number(timestamp),
            };
        }

        // eslint-disable-next-line no-empty
    } catch (e) {
        console.log(e);
    }
}

module.exports = { buildV4Buy, buildV4Sell, buildCpmmBuy, buildCpmmSell, parseV4Transaction, parseCpmmTransaction };