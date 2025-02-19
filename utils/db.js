const prisma = require('../prisma');
const { Keypair } = require('@solana/web3.js');
const { encodePk, decodePk } = require('./wallet');
const bs58 = require('bs58').default;


/* Adder */
async function addUser(telegramId, verifyWallet, verifySignature) {
    console.log({
        telegramId, verifyWallet, verifySignature,
    });
    const user = await prisma.user.create({
        data: {
            telegramId,
            verifyWallet,
            verifySignature,
            verified: true,
        },
    });

    return user;
}

async function addWallet(userId, privateKey, others) {

    // Check if private key is valid
    let walletAddress;
    try {
        const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
        walletAddress = wallet.publicKey.toBase58();
    } catch (e) {
        throw new Error('Invalid private key');
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        include: {
            wallets: true,
        },
    });
    if (!user) {
        throw new Error('User not exists');
    }

    // Check if wallet already exists
    const wallet = await prisma.wallet.findUnique({
        where: {
            address: walletAddress,
        },
    });
    if (wallet) {
        throw new Error('Wallet already exists');
    }

    // Add wallet to user
    const [, newWallet] = await prisma.$transaction([
        prisma.wallet.updateMany({
            data: {
                isDefault: false,
            },
            where: {
                userId: userId,
            },
        }),
        prisma.wallet.create({
            data: {
                user: {
                    connect: { id: user.id },
                },
                address: walletAddress,
                encodedPk: encodePk(privateKey),
                isDefault: true,
                ...others,
            },
        }),
    ]);

    return newWallet.address;
}

async function addTransaction(walletId, signature, type, amountIn, amountOut, tokenId, poolId, timestamp, blockId, buyTxId, triggerMode) {
    const transaction = await prisma.transaction.create({
        data: {
            walletId,
            signature,
            type,
            amountIn,
            amountOut,
            tokenId,
            poolId,
            timestamp,
            blockId,
            buyTxId,
            triggerMode,
        },
    });

    return transaction;
}

/* Updater */
async function updateUser(userId, data) {
    const user = await prisma.user.update({
        data,
        where: {
            id: userId,
        },
    });

    return user;
}

async function updateWallet(walletId, data) {
    const wallet = await prisma.wallet.update({
        data,
        where: {
            id: walletId,
        },
    });

    return wallet;
}

async function toggleDefaultWallet(userId, walletId) {
    await prisma.$transaction([
        prisma.wallet.updateMany({
            data: {
                isDefault: false,
            },
            where: {
                userId: userId,
                id: {
                    not: walletId,
                },
            },
        }),
        prisma.wallet.update({
            data: {
                isDefault: true,
            },
            where: {
                userId: userId,
                id: walletId,
            },
        }),
    ]);
}

/* Getter */
async function getUserByTgId(telegramId, includeWallets = false) {
    const userQuery = {
        where: {
            telegramId,
        },
    };

    if (includeWallets) {
        userQuery.include = {
            wallets: true,
        };
    }

    const user = await prisma.user.findUnique(userQuery);
    return user;
}

async function getUserByVerifyTx(verifySignature) {
    const user = await prisma.user.findFirst({
        where: {
            verifySignature,
        },
    });

    return user;
}

async function getUserByPaymentTx(paymentSignature) {
    const user = await prisma.user.findFirst({
        where: {
            paymentSignature,
        },
    });

    return user;
}

async function getUsers(where, includeWallets) {
    const query = {
        where,
    };

    if (includeWallets) {
        query.include = {
            wallets: true,
        };
    }

    const users = await prisma.user.findMany(query);
    return users;
}

async function getVerifiedCount() {
    const count = await prisma.user.count({
        where: {
            verified: true,
            isPaid: true,
        },
    });
    return count;
}

async function getWallet(walletId) {
    const wallet = await prisma.wallet.findUnique({
        where: {
            id: walletId,
        },
        include: {
            user: true,
        },
    });

    const privateKey = decodePk(wallet.encodedPk);
    wallet.signer = Keypair.fromSecretKey(bs58.decode(privateKey));

    return wallet;
}

async function getWalletsByTriggerMode(triggerMode) {
    let wallets = await prisma.wallet.findMany({
        where: {
            triggerMode,
            isActive: true,
        },
    });

    // Load signer
    wallets = wallets.map((t) => {
        return {
            ...t,
            signer: Keypair.fromSecretKey(bs58.decode(decodePk(t.encodedPk))),
        };
    });

    return wallets;
}

async function getWalletsByCriteria(criteria) {
    const {
        agScore,
        mcap,
        liquidity,
        triggerMode,
        deployerAge,
        dexscreenerPaid,
        ttc,
    } = criteria;

    let dexscreenerPaidPrepared;

    if (dexscreenerPaid === true) {
        dexscreenerPaidPrepared = 1;
    } else if (dexscreenerPaid === false) {
        dexscreenerPaidPrepared = 2;
    } else {
        dexscreenerPaidPrepared = 0;
    }

    let wallets = await prisma.wallet.findMany({
        where: {
            triggerMode,
            OR: [
                { dexscreenerPaid: dexscreenerPaidPrepared },
                { dexscreenerPaid: 0 },
            ],
            minLiquidity: {
                lte: liquidity,
            },
            maxLiquidity: {
                gte: liquidity,
            },
            minMcap: {
                lte: mcap,
            },
            maxMcap: {
                gte: mcap,
            },
            agScore: {
                lte: agScore,
            },
            deployerAge: {
                lte: deployerAge,
            },
            isActive: true,
            user: {
                verified: true,
                isPaid: true,
            },
        },
        include: {
            user: true,
        },
    });

    // Filter by TTC
    wallets = wallets.filter((wallet) => {
        if (ttc === null
            || !wallet.ttc
        ) {
            return true;
        }

        if (wallet.ttc >= ttc) {
            return true;
        }

        return false;
    });

    // Filter start/end time
    const now = new Date().getUTCHours();

    wallets = wallets.filter((wallet) => {
        const { startHour, endHour } = wallet;

        if (startHour === null
            || endHour === null
        ) {
            return true;
        }

        if (endHour < startHour) {
            return now >= startHour || now < endHour;
        } else {
            return now >= startHour && now < endHour;
        }
    });

    // Load signer
    wallets = wallets.map((t) => {
        return {
            ...t,
            signer: Keypair.fromSecretKey(bs58.decode(decodePk(t.encodedPk))),
        };
    });

    return wallets;
}

async function getTransaction(where) {
    const transaction = await prisma.transaction.findFirst({
        where,
        include: {
            wallet: {
                include: {
                    user: true,
                },
            },
        },
    });

    if (transaction) {
        transaction.wallet.signer = Keypair.fromSecretKey(bs58.decode(decodePk(transaction.wallet.encodedPk)));
    }

    return transaction;
}

async function getSellTransactions(txId) {
    const transactions = await prisma.transaction.findMany({
        where: {
            type: 'SELL',
            buyTxId: txId,
        },
    });

    return transactions;
}

async function getBuyTransactions(userId) {
    const buyTxs = await prisma.transaction.findMany({
        where: {
            type: 'BUY',
            wallet: {
                userId,
            },
        },
        include: {
            wallet: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
        take: 10,
    });

    const txIds = buyTxs.map(t => t.id);
    const sellTransactions = await prisma.transaction.findMany({
        where: {
            buyTxId: {
                in: txIds,
            },
        },
    });

    const txs = [];
    for (const tx of buyTxs) {
        const sellTxs = sellTransactions.filter(t => t.buyTxId == tx.id);
        txs.push({
            buyTx: tx,
            sellTxs,
        });
    }

    return txs;
}

async function getTransactionByPosition(userId, positionNo) {
    const transactions = await prisma.transaction.findMany({
        where: {
            type: 'BUY',
            wallet: {
                userId,
            },
        },
        include: {
            wallet: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
        skip: positionNo - 1,
        take: 1,
    });

    if (transactions.length > 0) {
        return transactions[0];
    }

    return null;
}

module.exports = { getUsers, getVerifiedCount, getUserByPaymentTx, addUser, addTransaction, addWallet, updateUser, updateWallet, toggleDefaultWallet, getSellTransactions, getTransaction, getUserByVerifyTx, getBuyTransactions, getWalletsByTriggerMode, getWalletsByCriteria, getUserByTgId, getTransactionByPosition, getWallet };