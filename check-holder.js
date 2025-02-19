const { getUsers, updateUser } = require('./utils/db');
const { verifyAGHolder } = require('./utils/verify');

// Function to update holders verification
async function syncHolders() {

    const users = await getUsers({}, false);

    for (const user of users) {
        const verifier = user.verifyWallet;
        console.log(`Check: ${verifier}`);
        // Check AG holder
        const isHolder = await verifyAGHolder(verifier);
        if (!isHolder) {
            // Update as not valid
            console.log(`Unverified: ${verifier}`);
            await updateUser(user.id, {
                verified: false,
            });
        }
    }

}


(async () => {
    await syncHolders();
})();