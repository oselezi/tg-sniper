const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Program, AnchorProvider, BN } = require('@coral-xyz/anchor');
const { getAssociatedTokenAddressSync, getAccount, createAssociatedTokenAccountInstruction, createCloseAccountInstruction } = require('@solana/spl-token');
const bs58 = require('bs58').default;

const idl = require('../idl/router.json');
const { ROUTER_PROGRAM_ID, FEE_ADDRESS } = require('../constants');
const { getComputePriorityIx, fetchTransaction } = require('./transaction');
const { compareUintArray } = require('./parser');


const PF_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PF_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
const PF_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PF_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');

const EVENT_DISCRIMINATOR = [228, 69, 165, 46, 81, 203, 154, 29];

function findSettingPda() {
    return PublicKey.findProgramAddressSync([
        Buffer.from('settings'),
    ], ROUTER_PROGRAM_ID)[0];
}

function findBondingCurvePda(mint) {
    return PublicKey.findProgramAddressSync([
        Buffer.from('bonding-curve'),
        new PublicKey(mint).toBuffer(),
    ], PF_PROGRAM_ID)[0];
}

async function buildPfBuy(connection, wallet, mint_, solAmount) {
    const signer = wallet.signer;
    const provider = new AnchorProvider(connection, signer);
    const program = new Program(idl, provider);

    const solAmountBN = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const slippage = wallet.buySlippage;
    const slippageBN = new BN(Math.floor(slippage * 100));
    console.log('Building pf buy', {
        wallet: wallet.address,
        mint_,
        solAmount,
        slippage,
    });

    const mint = new PublicKey(mint_);
    const authority = signer.publicKey;
    const setting = findSettingPda();
    const userAta = getAssociatedTokenAddressSync(mint, signer.publicKey);
    const bondingCurve = findBondingCurvePda(mint);
    const bondingCurveAta = getAssociatedTokenAddressSync(mint, bondingCurve, true);

    const ixs = [
        getComputePriorityIx(wallet.priorityFee),
    ];

    // Check if user ata exists
    let userAtaExists = false;
    try {
        const userAtaAccount = await getAccount(connection, userAta, 'confirmed');
        if (userAtaAccount.owner.toBase58() == signer.publicKey.toBase58()
            && userAtaAccount.mint.toBase58() == mint_) {
            userAtaExists = true;
        }
    } catch (ex) {
        // console.log(ex);
    }

    if (!userAtaExists) {
        ixs.push(
            createAssociatedTokenAccountInstruction(signer.publicKey, userAta, signer.publicKey, mint),
        );
    }

    const tx = await program.methods.pfBuy(
        solAmountBN,
        slippageBN,
    ).accounts({
        authority,
        setting,
        mint,
        userAta,
        bondingCurve,
        bondingCurveAta,
        feeRecipient: FEE_ADDRESS,
        pfGlobal: PF_GLOBAL,
        pfFeeRecipient: PF_FEE_RECIPIENT,
        pfEventAuthority: PF_EVENT_AUTHORITY,
        pfProgram: PF_PROGRAM_ID,
    })
        .preInstructions(ixs)
        .signers([signer])
        .transaction();

    return tx;
}

async function buildPfSell(connection, wallet, mint_, decimals, tokenAmount, isClose) {
    const signer = wallet.signer;
    const provider = new AnchorProvider(connection, signer);
    const program = new Program(idl, provider);

    const tokenAmountBN = new BN(Math.floor(tokenAmount * 10 ** decimals));
    const slippage = wallet.sellSlippage;
    const slippageBN = new BN(Math.floor(slippage * 100));
    console.log('Building pf sell', {
        wallet: wallet.address,
        mint_,
        tokenAmount,
        slippage,
    });

    const mint = new PublicKey(mint_);
    const authority = signer.publicKey;
    const setting = findSettingPda();
    const userAta = getAssociatedTokenAddressSync(mint, signer.publicKey);
    const bondingCurve = findBondingCurvePda(mint);
    const bondingCurveAta = getAssociatedTokenAddressSync(mint, bondingCurve, true);

    const prevIxs = [
        getComputePriorityIx(wallet.priorityFee),
    ];

    const postIxs = [];
    if (isClose) {
        postIxs.push(
            createCloseAccountInstruction(userAta, signer.publicKey, signer.publicKey),
        );
    }

    const tx = await program.methods.pfSell(
        tokenAmountBN,
        slippageBN,
    ).accounts({
        authority,
        setting,
        mint,
        userAta,
        bondingCurve,
        bondingCurveAta,
        feeRecipient: FEE_ADDRESS,
        pfGlobal: PF_GLOBAL,
        pfFeeRecipient: PF_FEE_RECIPIENT,
        pfEventAuthority: PF_EVENT_AUTHORITY,
        pfProgram: PF_PROGRAM_ID,
    })
        .preInstructions(prevIxs)
        .postInstructions(postIxs)
        .signers([signer])
        .transaction();

    return tx;
}

async function parsePfTransaction(connection, signature, decimals) {

    try {
        const txData = await fetchTransaction(connection, signature);
        if (!txData) {
            throw Error('Fetch transaction failed');
        }

        const { meta, slot, transaction } = txData;
        const instructions = transaction.message.instructions;
        const innerInstructions = meta.innerInstructions;

        // Merge main and inner instructions into one array
        let mergedIxs = [];
        for (let i = 0; i < instructions.length; i++) {
            mergedIxs.push(instructions[i]);

            const innerIxs = innerInstructions.filter(t => t.index == i);
            if (innerIxs.length > 0) {
                mergedIxs = mergedIxs.concat(innerIxs[0].instructions);
            }
        }
        for (let i = 0; i < mergedIxs.length; i++) {
            const { programId, data } = mergedIxs[i];
            if (!data || programId != PF_PROGRAM_ID.toBase58()) {
                continue;
            }

            const args = bs58.decode(data.toString());
            const discriminator = args.subarray(0, 8);
            if (compareUintArray(discriminator, EVENT_DISCRIMINATOR)) {
                const inputs = args.subarray(8);
                const dataView = new DataView(inputs.buffer);
                // const mint = new PublicKey(inputs.subarray(8, 40)).toBase58();
                const solAmount = dataView.getBigUint64(48, true);
                const tokenAmount = dataView.getBigUint64(56, true);
                // const isBuy = dataView.getUint8(64) == 1;
                // const user = new PublicKey(inputs.subarray(57, 89)).toBase58();
                const timestamp = dataView.getBigInt64(97, true);

                const solAmount_ = Number(solAmount) / LAMPORTS_PER_SOL;
                const tokenAmount_ = Number(tokenAmount) / (10 ** decimals);

                return {
                    solAmount: solAmount_,
                    tokenAmount: tokenAmount_,
                    slot,
                    timestamp: Number(timestamp),
                };
            }
        }
    } catch (e) {
        // console.log(e);
    }
}


module.exports = { buildPfBuy, buildPfSell, parsePfTransaction, findSettingPda };