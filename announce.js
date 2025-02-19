require('dotenv').config();
const { getUsers } = require('./utils/db');
const { dispatchNotification, notificationQueue } = require('./utils/queues');

(async () => {

    const msg = `<strong>📢 New Feature</strong>

We just added TTC (time to completion) to your wallet settings.

You can now specify your personal maximum TTC for MF/PF Fomo triggers. Enter this value in seconds and every alert that took longer to match the pattern will be automatically skipped.
`;

    const users = await getUsers();
    for (const user of users) {
        const chatId = user.telegramId;
        await dispatchNotification(`announce:${chatId}`, 'announcement', chatId, msg, {
            parse_mode: 'HTML',
        }, false, null, 2000);
    }

    // Close the queue
    await closeQueue(notificationQueue);

})();

async function closeQueue(queue) {
    try {
        await queue.close();
        console.log('Queue connection closed.');
    } catch (error) {
        console.error('Error closing queue:', error.message);
    }
}
