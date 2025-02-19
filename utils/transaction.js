const { ComputeBudgetProgram, SystemProgram, AddressLookupTableProgram, VersionedTransaction, TransactionMessage, TransactionExpiredBlockheightExceededError } = require('@solana/web3.js');
const { FEE_ADDRESS } = require('../constants');
const { NATIVE_MINT, createTransferCheckedInstruction, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const promiseRetry = require('promise-retry');
const { delay } = require('./helper');

function getComputePriorityIx(priorityFee) {
    return ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee,
    });
}

function getFeeTransferIx(sender, mint, amount, decimals) {
    if (mint == NATIVE_MINT.toBase58()) {
        return SystemProgram.transfer({
            fromPubkey: sender,
            toPubkey: FEE_ADDRESS,
            lamports: amount,
        });
    } else {
        const sourceAta = getAssociatedTokenAddressSync(mint, sender);
        const feeAta = getAssociatedTokenAddressSync(mint, FEE_ADDRESS);
        return createTransferCheckedInstruction(sourceAta, mint, feeAta, sender, amount, decimals);
    }
}

async function createLookupTable(connection, payer, addresses) {
    // Create the Address Lookup Table instruction
    const [createInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
        authority: payer.publicKey,
        payer: payer.publicKey,
        recentSlot: await connection.getSlot('confirmed'),
    });
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');

    // Create lookup table first
    await createAndSendV0Tx(connection, latestBlockhash, payer, [], [createInstruction]);
    const lookupTable = lookupTableAddress.toBase58();
    console.log(`Lookup table created: ${lookupTable}`);

    const chunkSize = 30;
    // Then extend it per 30 accounts
    for (let i = 0; i < addresses.length; i += chunkSize) {
        const _addresses = addresses.slice(i, i + chunkSize);
        console.log(_addresses);
        const extendInstruction = AddressLookupTableProgram.extendLookupTable({
            payer: payer.publicKey,
            authority: payer.publicKey,
            lookupTable: lookupTableAddress,
            addresses: _addresses,
        });

        await createAndSendV0Tx(connection, latestBlockhash, payer, [], [extendInstruction]);
    }

    return lookupTable;
}

async function sendAndConfirmTransaction(connection, latestBlockhash, tx) {
    const txid = await executeTransaction(connection, tx.serialize(), latestBlockhash);
    if (!txid) throw new Error('Failed to confirm transaction');

    return txid;
}

async function createAndSendV0Tx(connection, latestBlockhash, payer, signers, ixs, lookupTable, maxRetries = 3) {
    let attempt = 1;

    while (attempt <= maxRetries) {
        try {
            // Build the transaction
            const messageV0 = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: ixs,
            }).compileToV0Message(lookupTable ? [lookupTable] : []);

            const transaction = new VersionedTransaction(messageV0);
            transaction.sign([payer, ...signers]);

            console.log(`Attempt ${attempt}: Simulating transaction...`);

            // Simulate the transaction
            const ret = await connection.simulateTransaction(transaction, {
                sigVerify: true,
                commitment: 'confirmed',
                replaceRecentBlockhash: false,
            });

            // Check for simulation errors
            if (ret.value.err) {
                console.error('Transaction simulation failed:', ret.value.err, ret.value.logs);

                if (ret.value.err.toString().includes('BlockhashNotFound') && attempt < maxRetries) {
                    console.log('BlockhashNotFound detected. Fetching new blockhash...');
                } else {
                    throw new Error(`Transaction simulation failed: ${JSON.stringify(ret.value.err)}`);
                }
            } else {
                // Simulation succeeded, execute the transaction
                const txid = await executeTransaction(connection, transaction.serialize(), latestBlockhash);

                if (!txid) {
                    // Log an appropriate error if transaction execution fails
                    console.error('Transaction execution failed: No transaction ID returned.');
                    throw new Error('Transaction execution failed: No transaction ID returned.');
                }

                // If txid is valid, log success
                console.log(`Transaction executed successfully: ${txid}`);
                return txid;
            }
        } catch (error) {
            if (error.message.includes('BlockhashNotFound') && attempt < maxRetries) {
                console.log(`Retrying due to BlockhashNotFound (Attempt ${attempt} of ${maxRetries})...`);
            } else {
                // Log the detailed internal retry attempts
                console.error(`Error during transaction attempt ${attempt}:`, error.message);

                // Throw a simplified error for user-facing notifications
                throw new Error(`Transaction execution failed: ${error.message}`);
            }
        }

        // Refresh blockhash and retry
        latestBlockhash = await connection.getLatestBlockhash('confirmed');
        attempt++;
    }

    throw new Error(`Transaction failed after ${maxRetries} retries due to BlockhashNotFound.`);
}

async function executeTransaction(connection, tx, blockhashInfo) {
    const sendOptions = {
        maxRetries: 0,
        skipPreflight: true,
        preflightCommitment: 'confirmed',
    };

    const txid = await connection.sendRawTransaction(tx, sendOptions);
    console.log('send tx:', txid);

    const controller = new AbortController();
    const abortSignal = controller.signal;

    const abortableResender = async () => {
        while (!abortSignal.aborted) {
            await delay(2_000);
            try {
                await connection.sendRawTransaction(tx, sendOptions);
            } catch (e) {
                console.warn(`Failed to resend transaction: ${e}`);
            }
        }
    };

    try {
        abortableResender();
        const lastValidBlockHeight = blockhashInfo.lastValidBlockHeight;

        // this would throw TransactionExpiredBlockheightExceededError
        await Promise.race([
            connection.confirmTransaction(
                {
                    ...blockhashInfo,
                    lastValidBlockHeight,
                    signature: txid,
                    abortSignal,
                },
                'confirmed',
            ),
            (async () => {
                // In case ws socket died
                while (!abortSignal.aborted) {
                    await delay(2_000);
                    const signatureStatus = await connection.getSignatureStatus(txid, {
                        searchTransactionHistory: false,
                    });
                    if (signatureStatus?.value?.confirmationStatus === 'confirmed') {
                        return signatureStatus;
                    }
                }
            })(),
        ]);
    } catch (e) {
        if (e instanceof TransactionExpiredBlockheightExceededError) {
            // we consume this error and getTransaction would return null
            return null;
        } else {
            // invalid state from web3.js
            throw e;
        }
    } finally {
        controller.abort();
    }

    // in case rpc is not synced yet, we add some retries
    const txResult = await promiseRetry(
        async (retry) => {
            const response = await connection.getTransaction(txid, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });
            if (!response) {
                retry(response);
            }
            return response;
        },
        {
            retries: 10,
            minTimeout: 1e3,
        },
    );

    if (!txResult || txResult.meta?.err) {
        return null;
    }

    return txid;
}

async function fetchTransaction(connection, signature) {
    let data;
    for (let i = 0; i < 30; i++) {
        try {
            data = await connection.getParsedTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });

            if (data && data.meta) {
                if (data.meta.err) {
                    return null;
                } else {
                    break;
                }
            }
        // eslint-disable-next-line no-empty
        } catch {}

        await delay(2_000);
    }

    return data;
}

module.exports = { fetchTransaction, sendAndConfirmTransaction, createLookupTable, createAndSendV0Tx, getComputePriorityIx, getFeeTransferIx };