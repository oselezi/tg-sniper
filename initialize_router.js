require('dotenv').config();
const { SYSVAR_RENT_PUBKEY, SystemProgram, Keypair } = require('@solana/web3.js');
const { connection, FEE_ADDRESS, FEE_PERCENTAGE } = require('./constants');
const { AnchorProvider, Program, BN, Wallet } = require('@coral-xyz/anchor');
const { findSettingPda } = require('./utils/router');
const { bs58 } = require('@coral-xyz/anchor/dist/cjs/utils/bytes');
const idl = require('./idl/router.json');

(async () => {
    const adminKeypair = process.env.ROUTER_AUTH_PK;
    const signer = Keypair.fromSecretKey(bs58.decode(adminKeypair));
    const wallet = new Wallet(signer);
    const provider = new AnchorProvider(connection, wallet);
    const program = new Program(idl, provider);

    const feeBps = new BN(FEE_PERCENTAGE * 10000);
    const authority = signer.publicKey;
    const signature = await program.methods
        .initialize(feeBps)
        .accounts({
            authority,
            setting: findSettingPda(),
            feeRecipient: FEE_ADDRESS,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc({
            commitment: 'confirmed',
            preflightCommitment: 'confirmed',
        });
    console.log('Initialize:', signature);
})();