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
        SELECT *
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
            // Use projected location if available, otherwise fall back to calculated/camera location
            latitude: row.projected_latitude || row.latitude,
            longitude: row.projected_longitude || row.longitude,
            confidence: row.location_confidence,
            // Include original plaque location for reference
            original_latitude: row.latitude,
            original_longitude: row.longitude,
            // Include projected location explicitly
            projected_latitude: row.projected_latitude,
            projected_longitude: row.projected_longitude
        },
        photo: {
            id: row.photo_id,
            url: row.plaque_image_url || row.cropped_image_url || row.image_url,
            cropped_url: row.cropped_image_url,
            original_url: row.original_image_url || row.image_url,
            plaque_url: row.plaque_image_url,
            camera_position: {
                latitude: row.camera_latitude,
                longitude: row.camera_longitude,
                bearing: row.camera_bearing
            },
            // EXIF metadata (new)
            exif_data: {
                gps: row.exif_latitude && row.exif_longitude ? {
                    latitude: row.exif_latitude,
                    longitude: row.exif_longitude,
                    altitude: row.exif_altitude,
                    bearing: row.exif_bearing
                } : null,
                camera: {
                    make: row.camera_make,
                    model: row.camera_model,
                    device_orientation: row.exif_device_orientation,
                    focal_length_mm: row.focal_length_mm
                },
                image: {
                    width: row.image_width,
                    height: row.image_height,
                    capture_timestamp: row.capture_timestamp
                }
            }
        },
        position_in_image: {
            x: row.position_x,
            y: row.position_y
        },
        estimated_distance: row.estimated_distance,
        offset_direction: row.offset_direction,
        
        // YOLO detection data (new)
        yolo_detection: {
            bbox: row.yolo_bbox_x1 !== null ? {
                x1: row.yolo_bbox_x1,
                y1: row.yolo_bbox_y1,
                x2: row.yolo_bbox_x2,
                y2: row.yolo_bbox_y2
            } : null,
            confidence: row.yolo_confidence,
            dimensions: row.plaque_width && row.plaque_height ? {
                width: row.plaque_width,
                height: row.plaque_height,
                aspect_ratio: row.plaque_aspect_ratio
            } : null
        },
        
        // OCR consensus data (new)
        ocr_analysis: {
            method: row.ocr_method,
            consensus_score: row.ocr_consensus_score,
            services_used: row.ocr_services_used || [],
            processing_time: row.ocr_processing_time,
            timestamp: row.ocr_timestamp,
            agreement_matrix: row.ocr_agreement_matrix ? (() => {
                try { return JSON.parse(row.ocr_agreement_matrix); }
                catch(e) { return null; }
            })() : null
        },
        
        cropping_coordinates: row.cropping_x !== null && row.cropping_y !== null && 
                             row.cropping_width !== null && row.cropping_height !== null ? {
            x: row.cropping_x,
            y: row.cropping_y,
            width: row.cropping_width,
            height: row.cropping_height
        } : null,
        
        // Add extractor metadata (legacy)
        extractor_type: row.extractor_type,
        confidence_level: row.confidence_level,
        agreement_count: row.agreement_count,
        total_services: row.total_services,
        services_agreed: row.services_agreed ? row.services_agreed.split(',') : null,
        
        // Individual service results (Tesseract removed for better quality)
        individual_extractions: {
            openai: {
                text: row.openai_text,
                confidence: row.openai_confidence
            },
            claude: {
                text: row.claude_text,
                confidence: row.claude_confidence
            },
            google_vision: {
                text: row.google_vision_text,
                confidence: row.google_vision_confidence
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