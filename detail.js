const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');
const { enhancePlaqueWithMultipleImageUrls } = require('./utils/imageUrlMapper');

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
    
    if (!rows || rows.length === 0) {
        return rows;
    }
    
    // Format the result consistently with other endpoints
    const formattedPlaques = rows.map(row => ({
        id: row.id,
        text: row.plaque_text || "No text available",
        confidence: row.confidence || 0,
        location: {
            latitude: row.latitude,
            longitude: row.longitude,
            confidence: row.location_confidence
        },
        photo: {
            id: row.photo_id,
            url: row.image_url,
            camera_position: {
                latitude: row.camera_latitude,
                longitude: row.camera_longitude,
                bearing: row.camera_bearing
            }
        },
        position_in_image: {
            x: row.position_x,
            y: row.position_y
        },
        estimated_distance: row.estimated_distance,
        offset_direction: row.offset_direction
    }));
    
    // Enhance with multiple image URLs
    return formattedPlaques.map(enhancePlaqueWithMultipleImageUrls);
}

module.exports = {
    detail: functions.https.onRequest(detail),
};