const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');
const { enhancePlaquesWithMultipleImageUrls } = require('./utils/imageUrlMapper');

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
            cropped_image_url,
            original_image_url,
            photo_id,
            camera_latitude,
            camera_longitude,
            camera_bearing,
            position_x,
            position_y,
            estimated_distance,
            offset_direction,
            cropping_x,
            cropping_y,
            cropping_width,
            cropping_height,
            extractor_type,
            confidence_level,
            agreement_count,
            total_services,
            services_agreed,
            claude_text,
            claude_confidence,
            claude_result,
            openai_text,
            openai_confidence,
            openai_result,
            gemini_text,
            gemini_confidence,
            gemini_result
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
            url: row.cropped_image_url || row.image_url,
            cropped_url: row.cropped_image_url,
            original_url: row.original_image_url || row.image_url,
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
        cropping_coordinates: row.cropping_x !== null && row.cropping_y !== null && 
                             row.cropping_width !== null && row.cropping_height !== null ? {
            x: row.cropping_x,
            y: row.cropping_y,
            width: row.cropping_width,
            height: row.cropping_height
        } : null,
        
        // Add extractor metadata
        extractor_type: row.extractor_type,
        confidence_level: row.confidence_level,
        agreement_count: row.agreement_count,
        total_services: row.total_services,
        services_agreed: row.services_agreed ? row.services_agreed.split(',') : null,
        
        // Add individual extractor results
        individual_extractions: {
            claude: {
                text: row.claude_text,
                confidence: row.claude_confidence,
                raw_result: row.claude_result ? (() => {
                    try { return JSON.parse(row.claude_result); } 
                    catch(e) { return null; }
                })() : null
            },
            openai: {
                text: row.openai_text,
                confidence: row.openai_confidence,
                raw_result: row.openai_result ? (() => {
                    try { return JSON.parse(row.openai_result); } 
                    catch(e) { return null; }
                })() : null
            },
            gemini: {
                text: row.gemini_text,
                confidence: row.gemini_confidence,
                raw_result: row.gemini_result ? (() => {
                    try { return JSON.parse(row.gemini_result); } 
                    catch(e) { return null; }
                })() : null
            }
        }
    }));
    
    // Enhance plaques with multiple image URLs
    const enhancedPlaques = enhancePlaquesWithMultipleImageUrls(formattedRows);
    
    // Get total count for pagination info
    const countQuery = `SELECT COUNT(*) as total FROM \`${config.tableName}\` ${whereClause}`;
    const countOptions = {
        query: countQuery,
        params: params
    };
    const [countResult] = await bigquery.query(countOptions);
    
    const total = countResult[0].total;
    
    return {
        plaques: enhancedPlaques,
        total_count: total,
        page: Math.floor(offset / limit) + 1,
        limit: limit,
        offset: offset
    };
}

module.exports = {
    list: functions.https.onRequest(list),
};