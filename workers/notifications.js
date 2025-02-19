const { Worker } = require('bullmq');
const { notificationQueue } = require('../utils/queues');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: false });

const worker = new Worker(
    notificationQueue.name,
    async (job) => {
        const { chatId, message, options, pin, msgId } = job.data;

        const defaultOptions = {
            disable_web_page_preview: true,
            ...options,
        };

        try {
            let sentMessage;
            if (msgId) {
                const mergedOptions = {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: 'HTML',
                    ...defaultOptions,
                };
                sentMessage = await bot.editMessageText(message, mergedOptions);
                console.log(`Message edited to chatId: ${chatId}`);
            } else {
                sentMessage = await bot.sendMessage(chatId, message, defaultOptions);
                console.log(`Message sent to chatId: ${chatId}`);
            }
            if (pin) {
                try {
                    await bot.pinChatMessage(chatId, sentMessage.message_id);
                    console.log(`Message pinned in chatId: ${chatId}`);
                } catch (error) {
                    console.error(`Error pinning message in chatId ${chatId}:`, error.message);
                }
            }
        } catch (error) {
            if (error.response && error.response.body && error.response.body.error_code === 429) {
                // Default to 1 second if unspecified
                const retryAfter = error.response.body.parameters.retry_after || 1;
                console.log(`Rate limit hit. Retrying after ${retryAfter} seconds...`);

                // Throw error with retry_after attached as metadata
                const customError = new Error('Rate limit hit');
                // Attach retry_after value to the error object
                customError.retryAfter = retryAfter;
                throw customError;
            }

            console.error(`Failed to send message to chatId ${chatId}:`, error.message);
            // For other errors, let BullMQ handle retries
            throw error;
        }
    },
    {
        connection: notificationQueue.opts.connection,
        concurrency: 5,
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
    console.log(`Completed job ${job.id}`);
});

worker.on('failed', (job, err) => {
    console.log(`Failed job ${job.id} with error: ${err.message}`);
});