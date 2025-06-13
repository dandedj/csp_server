const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');

const list = async (req, res) => {
    CloudFunctionUtils.setCorsHeaders(req, res);

    try {
        const result = await queryAllPlaques(req);
        console.log(`Returning ${result.plaques.length} plaques out of ${result.total_count} total`);
        res.json(result);
    } catch (error) {
        console.error("Error fetching plaques:", error);
        res.status(500).json({
            error: "An error occurred fetching plaques",
            message: error.message
        });
    }
};

async function queryAllPlaques(req) {
    // Get query parameters with defaults
    const limit = parseInt(req.query.limit) || 500;
    const offset = parseInt(req.query.offset) || 0;
    const confidenceThreshold = parseInt(req.query.confidence_threshold) || 0;
    const grouped = req.query.grouped === 'true';
    
    // Get viewport bounds for spatial filtering
    const north = parseFloat(req.query.north);
    const south = parseFloat(req.query.south);
    const east = parseFloat(req.query.east);
    const west = parseFloat(req.query.west);
    
    // Check if bounds are provided and valid
    const hasValidBounds = !isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west);
    
    // Create query with pagination and filtering
    let whereClause = 'WHERE confidence >= @confidenceThreshold';
    let params = {
        confidenceThreshold: confidenceThreshold,
        limit: limit,
        offset: offset
    };
    
    // Add spatial filtering if bounds are provided
    if (hasValidBounds) {
        whereClause += ` AND latitude BETWEEN @south AND @north 
                        AND longitude BETWEEN @west AND @east`;
        params.north = north;
        params.south = south;
        params.east = east;
        params.west = west;
    }
    
    const query = `
        SELECT 
            id, 
            plaque_text,
            confidence,
            latitude, 
            longitude, 
            location_confidence,
            image_url,
            photo_id,
            camera_latitude,
            camera_longitude,
            camera_bearing,
            position_x,
            position_y,
            estimated_distance,
            offset_direction
        FROM \`${config.tableName}\`
        ${whereClause}
        ORDER BY confidence DESC
        LIMIT @limit OFFSET @offset
    `;
    
    const queryOptions = {
        query: query,
        params: params
    };
    
    console.log("Executing paginated query with params:", { confidenceThreshold, limit, offset });
    const [rows] = await bigquery.query(queryOptions);
    
    // Format the results consistently with search endpoint
    const formattedRows = rows.map(row => ({
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
    
    // Get total count for pagination info
    const countQuery = `SELECT COUNT(*) as total FROM \`${config.tableName}\` ${whereClause}`;
    const countOptions = {
        query: countQuery,
        params: params
    };
    const [countResult] = await bigquery.query(countOptions);
    
    const total = countResult[0].total;
    
    return {
        plaques: formattedRows,
        total_count: total,
        page: Math.floor(offset / limit) + 1,
        limit: limit,
        offset: offset
    };
}

module.exports = {
    list: functions.https.onRequest(list),
};