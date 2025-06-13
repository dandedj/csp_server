const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');

const detail = async (req, res) => {
    CloudFunctionUtils.setCorsHeaders(req, res);

    // get the text from the query string
    const id = req.query.id;

    const plaques = await queryPlaqueById(id);

    // return the plaques as a response
    // log the plaques to the console
    console.log(plaques);
    res.json(plaques);
};

async function queryPlaqueById(id) {
    const queryOptions = {
        query: `SELECT * FROM \`${config.tableName}\` WHERE id = @id LIMIT 1`,
        params: {
            id: id
        }
    };
    
    const [rows] = await bigquery.query(queryOptions);
    return rows;
}

module.exports = {
    detail: functions.https.onRequest(detail),
};