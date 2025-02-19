const { POOL_API_URL, POOL_API_KEY } = require('../constants');

async function getPoolInfo(token) {

    const url = `${POOL_API_URL}/token/${token}`;

    try {
        const resp = await fetch(url, {
            headers: {
                'x-api-key': POOL_API_KEY,
            },
        });
        const data = await resp.json();
        return data;
    } catch (ex) {
        console.log(`Error calling API with url ${url}`);
    }

    return null;

}

module.exports = { getPoolInfo };