const { Worker } = require('bullmq');
const { autobuyQueue, swapQueue } = require('../utils/queues');
const { getWalletsByCriteria } = require('../utils/db');

const worker = new Worker(
    autobuyQueue.name,
    async (job) => {
        // Call handleAutoBuys and return its result
        return await handleAutoBuys(job.data);
    },
    {
        connection: autobuyQueue.opts.connection,
        removeOnComplete: {
            // keep up to 24 hour
            age: 86400,
            // keep up to 1000 jobs
            count: 1000,
        },
        removeOnFail: {
            // keep up to 24 hour
            age: 86400,
            // keep up to 1000 jobs
            count: 1000,
        },
    },
);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await worker.close();
    process.exit(0);
});

worker.on('completed', (job) => {
    console.log(`Completed job ${job.id} with result: ${JSON.stringify(job.returnvalue)}`);
});

worker.on('failed', (job, err) => {
    console.log(`Failed job ${job.id} with error: ${err.message}`);
});

async function handleAutoBuys(data) {
    // fetch wallets
    const { criteria, onchainData } = data;
    const wallets = await getWalletsByCriteria(criteria);

    const dispatchResults = await Promise.all(
        wallets.map(async (wallet) => {
            try {
                const jobId = `buyingSwap:${onchainData.address}:${wallet.address}`;
                await swapQueue.add(
                    'exec-buying-swap',
                    {
                        walletId: wallet.id,
                        poolInfo: onchainData,
                        args: {
                            amount: wallet.buyAmount,
                            isBuy: true,
                        },
                    },
                    {
                        jobId,
                        attempts: 3,
                        backoff: {
                            type: 'fixed',
                            // Retry every 1 second
                            delay: 1000,
                        },
                    },
                );
                return { success: true, wallet };
            } catch (error) {
                console.error('Failed to dispatch swap', {
                    error,
                    wallet,
                    onchainData,
                });
                return { success: false, wallet, error };
            }
        }),
    );
    const swapsDispatched = dispatchResults.filter(result => result.success).length;

    // Return summary data to be displayed in Arena
    return {
        walletsMatched: wallets.length,
        swapsDispatched,
    };
}