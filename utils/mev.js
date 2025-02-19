const { default: axios } = require('axios');
const { JITO_ENGINE_URL, JITO_TIP_ADDRESS } = require('../constants');
const { SystemProgram } = require('@solana/web3.js');
const { delay } = require('./helper');
const bs58 = require('bs58').default;

const BUNDLE_MAX_RETRIES = 15;
async function sendToJitoEngine(connection, wallet, tx) {

    const signer = wallet.signer;

    // Add tip instruction after swap
    const tipAddress = JITO_TIP_ADDRESS;
    const tipAmount = wallet.tipMev;
    const tipIx = SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: tipAddress,
        lamports: tipAmount,
    });

    tx.instructions.push(tipIx);
    tx.sign(signer);

    const bundles = [
        bs58.encode(tx.serialize()),
    ];

    let signature;
    let bundleId;
    let isSuccess = false;
    try {
        const ret = await connection.simulateTransaction(tx);
        if (ret.value.err) {
            console.log('Transaction simulation failed: ', ret.value.err, ret.value.logs);
            return null;
        }

        const response = await axios.post(`${JITO_ENGINE_URL}/api/v1/bundles`, {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'sendBundle',
            'params': [
                bundles,
            ],
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        bundleId = response.data.result;
        console.log('Bundle queued:', bundleId);
        for (let i = 0; i < BUNDLE_MAX_RETRIES; i++) {
            try {
                const statusResponse = await axios.post(`${JITO_ENGINE_URL}/api/v1/bundles`, {
                    'jsonrpc': '2.0',
                    'id': 1,
                    'method': 'getBundleStatuses',
                    'params': [
                        [bundleId],
                    ],
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
                const value = statusResponse.data.result.value;
                signature = value[0].transactions[0];
                isSuccess = true;
                break;
            // eslint-disable-next-line no-empty
            } catch {}
            await delay(2000);
        }
    } catch (ex) {
        console.log('Send bundle failed', ex);
    }

    if (!isSuccess) {
        console.log(`Confirm bundle failed: ${bundleId}`);
    }

    return signature;
}

module.exports = { sendToJitoEngine };