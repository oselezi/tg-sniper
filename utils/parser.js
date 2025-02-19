const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { sha256 } = require('js-sha256');
const { SOL_MINT } = require('../constants');

function compareUintArray(a, b) {

    if (a.length != b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }

    return true;
}

function getMint(account, accountKeys, balanceChanges) {
    const idx = accountKeys.findIndex(t => t == account);

    for (const balance of balanceChanges) {
        if (balance.accountIndex == idx) {
            return balance.mint;
        }
    }

    // If no token changes, then can be WSOL
    return SOL_MINT;
}

function getDecimal(mint, balanceChanges) {
    for (const balance of balanceChanges) {
        if (balance.mint == mint) {
            return balance.uiTokenAmount.decimals;
        }
    }

    // If no token changes, then can be WSOL
    return 0;
}

function getUiBalance(account, accountKeys, balances) {
    const idx = accountKeys.findIndex(t => t == account);

    for (const balance of balances) {
        if (balance.accountIndex == idx) {
            return balance.uiTokenAmount.uiAmount ?? 0;
        }
    }

    // If no token changes, then can be WSOL
    return 0;
}

function getSolBalance(account, accountKeys, balances) {
    const idx = accountKeys.findIndex(t => t == account);
    return balances[idx] / LAMPORTS_PER_SOL;
}

function getBalanceUpdate(account, accountKeys, preBalances, postBalances) {
    const idx = accountKeys.findIndex(t => t == account);

    let preBalance = 0;
    for (const balance of preBalances) {
        if (balance.accountIndex == idx) {
            preBalance = balance.uiTokenAmount.amount;
            break;
        }
    }

    let postBalance = 0;
    for (const balance of postBalances) {
        if (balance.accountIndex == idx) {
            postBalance = balance.uiTokenAmount.amount;
            break;
        }
    }

    return Math.abs(postBalance - preBalance);
}

function getDiscriminator(method) {
    const discriminator = Buffer.from(sha256.digest('global:' + method)).slice(0, 8);
    return discriminator;
}

const slotMap = {};
async function fetchBlockTime(connection, slot, retries = 5) {
    // New request
    if (!slotMap[slot]) {
        // Assign temp value
        slotMap[slot] = -1;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const blockTime = await connection.getBlockTime(slot);
                if (blockTime !== null) {
                    slotMap[slot] = blockTime;
                    return blockTime;
                }
                // console.log(`Block time not found for slot: ${slot}, retrying...`);
            } catch (error) {
                // console.error('Error fetching block time:', error);
            }
            await new Promise(res => setTimeout(res, 2000));
        }
        throw new Error(`Unable to fetch block time for slot: ${slot}`);
    } else if (slotMap[slot] == -1) {
        // If requested by before, then wait till finished
        for (let attempt = 0; attempt < retries; attempt++) {
            if (slotMap[slot] != -1) {
                return slotMap[slot];
            }

            await new Promise(res => setTimeout(res, 2000));
        }
        throw new Error(`Unable to fetch block time for slot: ${slot}`);
    } else {
        return slotMap[slot];
    }

}

module.exports = { compareUintArray, getMint, getDiscriminator, getDecimal, getUiBalance, getSolBalance, getBalanceUpdate, fetchBlockTime };