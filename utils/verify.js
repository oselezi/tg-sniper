const { SystemProgram, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const { VERIFY_AMOUNT, connection, FEE_ADDRESS, PAYMENT_AMOUNT } = require('../constants');
const { getUserByTgId, getUserByVerifyTx, addUser, updateUser, getUserByPaymentTx } = require('./db');
const { delay } = require('./helper');

async function getVerifyAccount() {

    for (let idx = 0; idx < 30; idx++) {
        try {
            const account = Keypair.generate().publicKey;
            const accountInfo = await connection.getAccountInfo(account);
            if (!accountInfo) {
                return account.toBase58();
            }
        } catch (ex) {
            console.log(ex);
        }

        await delay(500);
    }
}

async function verifyUserByTx(txSignature, tgId, verifyAccount) {

    console.log({
        txSignature,
        tgId,
        verifyAccount,
    });

    // Check already verified
    const user = await getUserByTgId(tgId);
    if (user && user.verified) {
        throw new Error('User already verified');
    }

    // Check signature already used
    const record = await getUserByVerifyTx(txSignature);
    if (record) {
        throw new Error('This TX signature is already used');
    }

    let verifier;

    // Check Admin transfer
    const tx = await connection.getParsedTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 1,
    });
    if (tx.meta.err) {
        throw new Error('This transaction not successed');
    }

    const ixs = tx.transaction.message.instructions;
    for (const ix of ixs) {
        if (!ix.programId.equals(SystemProgram.programId) || !ix.parsed) {
            continue;
        }

        const { info, type } = ix.parsed;
        if (type == 'transfer') {
            const { destination, lamports, source } = info;
            if (destination == verifyAccount
                && lamports >= VERIFY_AMOUNT * LAMPORTS_PER_SOL
            ) {
                verifier = source;
                break;
            }
        }
    }
    if (!verifier) {
        throw new Error('Transaction is not valid! Please try again!');
    }

    // Check AG holder
    const isHolder = await verifyAGHolder(verifier);
    if (!isHolder) {
        throw new Error('Transaction sender does not hold any AG NFT! Please try again!');
    }

    // Update or create user
    let userId;
    if (user) {
        const user_ = await updateUser(user.id, {
            verified: true,
            verifySignature: txSignature,
            verifyWallet: verifier,
        });
        userId = user_.id;
    } else {
        const user_ = await addUser(tgId, verifier, txSignature);
        userId = user_.id;
    }

    return userId;
}

async function confirmFeeTx(txSignature, tgId, verifyAccount) {

    console.log({
        txSignature,
        tgId,
        verifyAccount,
    });

    // Check already verified
    const user = await getUserByTgId(tgId);
    if (user && user.isPaid) {
        throw new Error('User already paid');
    }

    // Check signature already used
    const record = await getUserByPaymentTx(txSignature);
    if (record) {
        throw new Error('This TX signature is already used');
    }

    // Check Admin transfer
    const tx = await connection.getParsedTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 1,
    });
    if (tx.meta.err) {
        throw new Error('This transaction not successed');
    }

    let isConfirmed = false;
    const ixs = tx.transaction.message.instructions;
    for (const ix of ixs) {
        if (!ix.programId.equals(SystemProgram.programId) || !ix.parsed) {
            continue;
        }

        const { info, type } = ix.parsed;
        if (type == 'transfer') {
            const { destination, lamports, source } = info;
            if (destination == FEE_ADDRESS.toBase58()
                && source == verifyAccount
                && lamports >= PAYMENT_AMOUNT * LAMPORTS_PER_SOL
            ) {
                isConfirmed = true;
                break;
            }
        }
    }
    if (!isConfirmed) {
        throw new Error('Transaction is not valid! Please try again!');
    }

    // Update or create user
    const userId = user.id;
    await updateUser(userId, {
        isPaid: true,
        paymentSignature: txSignature,
    });

    return userId;
}

async function verifyAGHolder(holder) {

    // Load AG mints
    const mintsTxt = fs.readFileSync('./mints.txt', 'utf-8');
    const mints = mintsTxt.split('\n').map(t => t.trim()).filter(t => !!t && t.length > 0);

    // Get all ATAs
    const atas = await connection.getParsedTokenAccountsByOwner(new PublicKey(holder), {
        programId: TOKEN_PROGRAM_ID,
    }, 'confirmed');

    let isHolder = false;
    for (const ata of atas.value) {
        const { info } = ata.account.data.parsed;
        const { mint, tokenAmount } = info;
        if (tokenAmount.uiAmount == 1 && mints.includes(mint)) {
            isHolder = true;
            break;
        }
    }

    return isHolder;
}

module.exports = { verifyUserByTx, confirmFeeTx, verifyAGHolder, getVerifyAccount };