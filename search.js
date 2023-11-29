const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');

const search = async (req, res) => {
    CloudFunctionUtils.setCorsHeaders(req, res);

    // get the text from the query string
    const text = req.query.text;

    const plaques = await queryPlaquesWithText(text);

    // return the plaques as a response
    // log the plaques to the console
    console.log(plaques);
    res.json(plaques);
};


async function queryPlaquesWithText(text) {
    const plaques = await bigquery.query({
        query: `SELECT * FROM \`${config.tableName}\` WHERE LOWER(text) LIKE "%${text.toLowerCase()}%"`
    });

    return plaques[0];
}

module.exports = {
    search: functions.https.onRequest(search),
};