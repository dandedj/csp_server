const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');
const { enhancePlaqueWithMultipleImageUrls } = require('./utils/imageUrlMapper');

const detail = async (req, res) => {
    CloudFunctionUtils.setCorsHeaders(req, res);

    try {
        // Get the ID from either path parameter or query parameter
        const id = req.params.id || req.query.id;
        
        if (!id) {
            return res.status(400).json({ error: 'Plaque ID is required' });
        }

        console.log(`Fetching plaque with ID: ${id}`);
        const plaques = await queryPlaqueById(id);

        // return the plaques as a response
        console.log(`Found ${plaques.length} plaques for ID: ${id}`);
        res.json(plaques);
    } catch (error) {
        console.error('Error in detail endpoint:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
};

async function queryPlaqueById(id) {
    try {
        const queryOptions = {
            query: `SELECT * FROM \`${config.tableName}\` WHERE id = @id LIMIT 1`,
            params: {
                id: id
            }
        };
        
        console.log(`Executing BigQuery: ${queryOptions.query} with id: ${id}`);
        const [rows] = await bigquery.query(queryOptions);
        
        if (!rows || rows.length === 0) {
            console.log(`No plaque found with ID: ${id}`);
            return [];
        }
        
        console.log(`Found plaque data:`, rows[0]);
    } catch (error) {
        console.error('Error querying BigQuery:', error);
        throw error;
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
        offset_direction: row.offset_direction,
        // Add cropping coordinates if available
        cropping_coordinates: row.cropping_x !== null && row.cropping_y !== null && 
                             row.cropping_width !== null && row.cropping_height !== null ? {
            x: row.cropping_x,
            y: row.cropping_y,
            width: row.cropping_width,
            height: row.cropping_height
        } : null
    }));
    
    // Enhance with multiple image URLs
    return formattedPlaques.map(enhancePlaqueWithMultipleImageUrls);
}

module.exports = {
    detail: functions.https.onRequest(detail),
};