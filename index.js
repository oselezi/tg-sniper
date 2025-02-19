require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { handleStartCommand, handlePositionsCommand, handlePositionCommand } = require('./controllers/commandHandlers');
const { handleCallbackQuery } = require('./controllers/callbackQueryHandlers');
const { handleMessageInput } = require('./controllers/messageHandlers');

process.env.NTBA_FIX_350 = true;

// Initialize Telegram Bot with your API token
const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: true });

// Log successful bot startup
bot.on('polling_error', (error) => {
    console.log(`Polling error: ${error.message}`);
});

// Set custom bot commands
const commands = [
    { command: 'start', description: 'Let\'s harvest!' },
    { command: 'positions', description: 'Last 10 positions' },
];

bot.setMyCommands(commands)
    .then(() => {
        console.log('Custom commands have been set.');
    })
    .catch((error) => {
        console.error('Error setting custom commands:', error);
    });

// Callback query handler
bot.on('callback_query', async (query) => {
    await handleCallbackQuery(bot, query);
});

// Command handler setup
bot.onText(/\/start/, async (msg) => await handleStartCommand(bot, msg));
bot.onText(/\/positions/, async (msg) => await handlePositionsCommand(bot, msg));
bot.onText(/^\/\d+$/, async (msg) => await handlePositionCommand(bot, msg));

bot.on('message', async (msg) => await handleMessageInput(bot, msg));

// Start listening to incoming messages
console.log('Bot is running...');
