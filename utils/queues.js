require('dotenv').config();
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Initialize Redis connection and queue
const connection = new IORedis({
    password: process.env.REDIS_PW,
    maxRetriesPerRequest: null,
});

const autobuyQueue = new Queue('autobuy-queue', { connection });

const notificationQueue = new Queue('notification-queue', {
    connection,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'custom',
            delay: (attemptsMade, err) => {
                if (err.retryAfter) {
                    // Use retry_after in milliseconds
                    return err.retryAfter * 1000;
                }

                // Fallback to exponential backoff if retry_after is unavailable
                // Exponential backoff
                return Math.pow(2, attemptsMade) * 1000;
            },
        },
    },
});

const swapQueue = new Queue('swap-queue', { connection });

async function dispatchNotification(jobId, jobName, chatId, message, options, pin = false, msgId = null, delay = 0) {
    const timestamp = Date.now();
    // Convert BigInt values to strings
    const sanitizedChatId = chatId.toString();
    const sanitizedMsgId = msgId ? msgId.toString() : null;

    try {
        await notificationQueue.add(
            jobName,
            { chatId: sanitizedChatId, message, options, pin, msgId: sanitizedMsgId },
            {
                jobId: `${jobId}:${timestamp}`,
                delay,
            },
        );
    } catch (error) {
        console.error(`Failed to dispatch notification job ${jobId}:`, error.message);
    }
}

async function dispatchSellingSwap(args, wallet, poolInfo) {
    const jobId = `sellingSwap:${poolInfo.address}:${wallet.address}:${args.amount}`;
    await swapQueue.add(
        'exec-selling-swap',
        {
            args,
            poolInfo,
            walletId: wallet.id,
        },
        {
            jobId,
            attempts: 1,
            // backoff: {
            //     type: 'fixed',
            //     // Retry every 1 second
            //     delay: 1000,
            // },
        },
    );
    return true;
}

// Export the queue and connection
module.exports = {
    autobuyQueue,
    notificationQueue,
    swapQueue,
    dispatchNotification,
    dispatchSellingSwap,
};