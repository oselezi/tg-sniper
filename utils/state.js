const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const Redis = require('ioredis');

const redis = new Redis({
    password: process.env.REDIS_PW,
});

// Global debug flag
const debug = false;
// Redis ttl
const redisTtl = 3600;

// Debugging function
function logDebug(message, data = null) {
    if (debug) {
        console.log(`[DEBUG]: ${message}`);
        if (data) console.log('[DEBUG DATA]:', data);
    }
}

// Function to get user state
async function getUserState(telegramId) {
    logDebug(`Fetching state for user with telegramId: ${telegramId}`);

    const redisState = await redis.get(`user:${telegramId}:state`);
    if (redisState) {
        logDebug(`State found in Redis for user ${telegramId}`, redisState);
        return JSON.parse(redisState);
    }

    const user = await prisma.user.findUnique({ where: { telegramId: telegramId } });
    if (user && user.state) {
        logDebug(`State found in database for user ${telegramId}`, user.state);
        await redis.set(`user:${telegramId}:state`, user.state, 'EX', redisTtl);
        return JSON.parse(user.state);
    }

    logDebug(`No state found for user ${telegramId}. Returning default state.`);
    return {};
}

async function setUserState(telegramId, key, value) {
    logDebug(`Setting state key "${key}" for user ${telegramId} with value`, value);

    // Fetch the current state from Redis
    const redisState = await getUserState(telegramId);

    // Update the state with the new key-value pair
    const newState = { ...redisState, [key]: value };

    // Save the updated state in Redis
    await redis.set(`user:${telegramId}:state`, JSON.stringify(newState), 'EX', redisTtl);
    logDebug(`Updated state in Redis for user ${telegramId}`);

    // Check if the user exists in the database
    const user = await prisma.user.findUnique({
        where: { telegramId },
    });

    if (user) {
        // Persist updated state in the database for existing users
        await prisma.user.update({
            where: { telegramId },
            data: { state: JSON.stringify(newState) },
        });
        logDebug(`Updated state in database for user ${telegramId}`);
    } else {
        logDebug(`User with ID ${telegramId} does not exist in the database. State saved only in Redis.`);
    }
}

// Function to clear user state or a specific key
async function clearUserState(telegramId, key = null) {
    logDebug(`Clearing state for user ${telegramId}${key ? `, key: ${key}` : ''}`);

    if (key) {
        // Fetch the current state
        const currentState = await getUserState(telegramId);

        // If the key exists in the state, delete it
        if (currentState[key]) {
            delete currentState[key];
            logDebug(`Key "${key}" cleared from state for user ${telegramId}`);

            // Update the new state in Redis
            await redis.set(`user:${telegramId}:state`, JSON.stringify(currentState), 'EX', redisTtl);
            logDebug(`Updated state in Redis for user ${telegramId}`);

            // Check if the user exists in the database
            const user = await prisma.user.findUnique({ where: { telegramId } });

            if (user) {
                // Persist the updated state in the database
                await prisma.user.update({
                    where: { telegramId },
                    data: { state: JSON.stringify(currentState) },
                });
                logDebug(`Updated state in database for user ${telegramId}`);
            } else {
                logDebug(`User with ID ${telegramId} does not exist in the database. State updated only in Redis.`);
            }
        } else {
            logDebug(`Key "${key}" not found in state for user ${telegramId}`);
        }
    } else {
        // Clear the entire state
        await redis.del(`user:${telegramId}:state`);
        logDebug(`State cleared from Redis for user ${telegramId}`);

        // Check if the user exists in the database
        const user = await prisma.user.findUnique({ where: { telegramId } });

        if (user) {
            await prisma.user.update({
                where: { telegramId },
                data: { state: null },
            });
            logDebug(`State cleared from database for user ${telegramId}`);
        } else {
            logDebug(`User with ID ${telegramId} does not exist in the database. State cleared only in Redis.`);
        }
    }
}

module.exports = { getUserState, setUserState, clearUserState };