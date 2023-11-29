const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');

const list = async (req, res) => {
    CloudFunctionUtils.setCorsHeaders(req, res);

    const plaques = await queryAllPlaques();

    // return the plaques as a response
    // log the plaques to the console
    console.log(plaques);
    res.json(plaques);
};

async function queryAllPlaques() {
    const plaques = await bigquery.query({
        query: `SELECT * FROM \`${config.tableName}\``
    });

    return plaques[0];
}

module.exports = {
    list: functions.https.onRequest(list),
};