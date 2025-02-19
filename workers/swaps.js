const { Worker } = require('bullmq');
const { swapQueue } = require('../utils/queues');
const { swap } = require('../utils/swap');
const { getWallet } = require('../utils/db');

const worker = new Worker(
    swapQueue.name,
    async (job) => {
        const { walletId, poolInfo, args } = job.data;
        const wallet = await getWallet(walletId);

        try {
            const signature = await swap(wallet, poolInfo, args, job.attemptsMade, job.opts.attempts);
            console.log(`Swap successful for wallet ${wallet.address}: ${signature}`);
        } catch (error) {
            console.error(`Job failed for wallet ${walletId}:`, error.message);
            // Let BullMQ handle the failure
            throw error;
        }
    },
    {
        connection: swapQueue.opts.connection,
        concurrency: 15,
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

process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await worker.close();
    process.exit(0);
});

worker.on('completed', (job) => {
    console.log(`Completed job ${job.id}`);
});

worker.on('failed', (job, err) => {
    console.log(`Failed job ${job.id} with error: ${err.message}`);
});
