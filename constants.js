const { PublicKey, Connection } = require('@solana/web3.js');

require('dotenv').config();

const HELIUS_API_KEY = process.env['HELIUS_API_KEY'] ?? '';
const TG_BOT_TOKEN = process.env['TG_BOT_TOKEN'] ?? '';
const PK_SALT = process.env['PK_SALT'] ?? '';
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const STAKED_RPC_URL = `https://staked.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

const connection = new Connection(RPC_URL);
const stakedConnection = new Connection(STAKED_RPC_URL);

const POOL_API_URL = process.env['POOL_API_URL'] ?? '';
const POOL_API_KEY = process.env['POOL_API_KEY'] ?? '';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const RAYDIUM_ROUTING_PROGRAM_ID = new PublicKey('routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS');
const RAYDIUM_CPMM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const RAYDIUM_V4_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

const ROUTER_PROGRAM_ID = new PublicKey(process.env['ROUTER_PROGRAM'] ?? '');
// const LOOKUP_TABLE_ADDRESS = new PublicKey(process.env['LOOKUP_TABLE_ADDRESS'] ?? '');

const JITO_ENGINE_URL = process.env['JITO_ENGINE_URL'] ?? '';
const JITO_TIP_ADDRESS = new PublicKey(process.env['JITO_TIP_ADDRESS'] ?? '');

const FEE_ADDRESS = new PublicKey(process.env['FEE_ADDRESS'] ?? '');
// In percentage so 0.01 means 1%
const FEE_PERCENTAGE = 0.01;

const VERIFY_AMOUNT = 0.005;
const PAYMENT_AMOUNT = process.env['PAYMENT_AMOUNT'] ?? 0.05;

const ACTIVE_WALLETS_LIMIT = 5;
const MAX_USERS_LIMIT = Number(process.env['MAX_USERS_LIMIT'] ?? '50');

// module.exports = { CPMM_PROGRAM_ID, RPC_URL, FEE_ADDRESS, TG_BOT_TOKEN, FEE_PERCENTAGE, LOOKUP_TABLE_ADDRESS };
module.exports = { connection, stakedConnection, ROUTER_PROGRAM_ID, PAYMENT_AMOUNT, MAX_USERS_LIMIT, POOL_API_URL, POOL_API_KEY, JITO_ENGINE_URL, JITO_TIP_ADDRESS, SOL_MINT, RAYDIUM_CPMM_PROGRAM_ID, RAYDIUM_V4_PROGRAM_ID, RAYDIUM_ROUTING_PROGRAM_ID, PK_SALT, TG_BOT_TOKEN, FEE_ADDRESS, FEE_PERCENTAGE, VERIFY_AMOUNT, ACTIVE_WALLETS_LIMIT };