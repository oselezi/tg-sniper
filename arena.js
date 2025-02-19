const Arena = require('bull-arena');
const express = require('express');
const { autobuyQueue, notificationQueue, swapQueue } = require('./utils/queues');
const app = express();

const arena = Arena(
    {
        BullMQ: autobuyQueue.constructor,
        queues: [
            {
                type: 'bullmq',
                name: autobuyQueue.name,
                hostId: 'tgsniper',
                redis: autobuyQueue.opts.connection.options,
            },
            {
                type: 'bullmq',
                name: notificationQueue.name,
                hostId: 'tgsniper',
                redis: notificationQueue.opts.connection.options,
            },
            {
                type: 'bullmq',
                name: swapQueue.name,
                hostId: 'tgsniper',
                redis: swapQueue.opts.connection.options,
            },
        ],
    },
    {
        port: 4567,
        disableListen: true,
    },
);

app.use('/arena', arena);

app.listen(3000, () => {
    console.log('Arena is accessible at http://localhost:3000/arena');
});
