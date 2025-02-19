const crypto = require('crypto');
const { PublicKey } = require('@solana/web3.js');

const { PK_SALT, connection } = require('../constants');

const encodeAlgorithm = 'aes-256-cbc';

function encodePk(pk) {
    const key = crypto.createHash('sha256').update(PK_SALT).digest('base64').substr(0, 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(encodeAlgorithm, key, iv);
    let encrypted = cipher.update(pk, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return the IV along with the encrypted data
    return iv.toString('hex') + ':' + encrypted;
}

function decodePk(pk) {
    const key = crypto.createHash('sha256').update(PK_SALT).digest('base64').substr(0, 32);

    // Split the IV and the encrypted data
    const parts = pk.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encrypted = parts.join(':');

    const decipher = crypto.createDecipheriv(encodeAlgorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

async function checkBalance(wallet) {
    const pubkey = new PublicKey(wallet.address);

    try {
        const balance = await connection.getBalance(pubkey, 'confirmed');
        return balance;
    } catch {
        return 0;
    }
}

module.exports = { decodePk, encodePk, checkBalance };