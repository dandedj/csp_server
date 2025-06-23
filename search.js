const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();
const CloudFunctionUtils = require('./CloudFunctionUtils');
const config = require('./config');
const { enhancePlaquesWithMultipleImageUrls } = require('./utils/imageUrlMapper');

const search = async (req, res) => {
    CloudFunctionUtils.setCorsHeaders(req, res);

    // Determine if we're accessing via the old path (/search) or new API path (/api/plaques)
    // Extract query parameters based on endpoint pattern
    let query, confidenceThreshold, limit, offset;
    
    // Check URL path to determine which API format is being used
    const pathParts = req.path.split('/');
    const isNewApiFormat = pathParts.includes('api') && pathParts.includes('plaques');
    
    if (isNewApiFormat) {
        // New API format: /api/plaques?q=query&confidence_threshold=50
        query = req.query.q || req.query.text || req.query.plaque_text;
        confidenceThreshold = parseInt(req.query.confidence_threshold) || 0;
        limit = parseInt(req.query.limit) || 100;
        offset = parseInt(req.query.offset) || 0;
    } else {
        // Original format: /search?text=query or /search?plaque_text=query
        query = req.query.q || req.query.text || req.query.plaque_text;
        confidenceThreshold = parseInt(req.query.confidence_threshold) || 0;
        limit = parseInt(req.query.limit) || 100;
        offset = parseInt(req.query.offset) || 0;
    }

    if (!query) {
        return res.status(400).json({ 
            error: 'Missing search query parameter',
            message: 'Please provide a search query using the "q", "text", or "plaque_text" parameter'
        });
    }

    try {
        // Get both the total count and the paginated results
        const { plaques, totalCount } = await queryPlaquesWithText(query, confidenceThreshold, limit, offset);

        // Log the plaques to the console
        console.log(`Found ${plaques.length} plaques matching query: ${query} (offset: ${offset}, limit: ${limit}, total: ${totalCount})`);
        console.log('Sample plaque:', plaques.length > 0 ? JSON.stringify(plaques[0], null, 2) : 'No plaques found');
        
        // Format response based on which API format
        if (isNewApiFormat) {
            res.json({
                plaques: plaques,
                total_count: totalCount,
                filtered_count: totalCount,
                offset: offset,
                limit: limit
            });
        } else {
            // For backward compatibility - ensure text field is included at the top level
            const compatPlaques = plaques.map(plaque => ({
                ...plaque,
                // Don't convert text to array - this causes issues with substring() calls
                text: plaque.text  // Keep as string for better compatibility
            }));
            
            // Add pagination info even in backward compatibility mode
            res.set('X-Total-Count', totalCount.toString());
            res.set('X-Offset', offset.toString());
            res.set('X-Limit', limit.toString());
            
            res.json(compatPlaques);
        }
    } catch (error) {
        console.error("Error executing query:", error);
        res.status(500).json({
            error: "An error occurred during search",
            message: error.message
        });
    }
};

async function queryPlaquesWithText(query, confidenceThreshold, limit = 100, offset = 0) {
    try {
        // Prepare the search pattern with wildcards
        const searchPattern = `%${query.toLowerCase()}%`;
        
        // First get the total count that matches the query
        const countQuery = `
            SELECT COUNT(*) as total
            FROM \`${config.tableName}\`
            WHERE 
                (
                    LOWER(plaque_text) LIKE @searchPattern OR
                    LOWER(id) LIKE @searchPattern
                )
                AND confidence >= @confidenceThreshold
        `;
        
        const countOptions = {
            query: countQuery,
            params: {
                searchPattern: searchPattern,
                confidenceThreshold: confidenceThreshold
            }
        };
        
        console.log("Executing count query with params:", { searchPattern, confidenceThreshold });
        const [countResult] = await bigquery.query(countOptions);
        const totalCount = countResult[0].total || 0;
        
        // Now get the paginated results
        const sqlQuery = `
            SELECT *
            FROM 
                \`${config.tableName}\`
            WHERE 
                (
                    LOWER(plaque_text) LIKE @searchPattern OR
                    LOWER(id) LIKE @searchPattern
                )
                AND confidence >= @confidenceThreshold
            ORDER BY 
                confidence DESC
            LIMIT @limit
            OFFSET @offset
        `;

        const queryOptions = {
            query: sqlQuery,
            params: {
                searchPattern: searchPattern,
                confidenceThreshold: confidenceThreshold,
                limit: limit,
                offset: offset
            }
        };

        console.log(`Executing SQL query with params:`, { searchPattern, confidenceThreshold, limit, offset });
        const [rows] = await bigquery.query(queryOptions);
        
        // Check if we have results
        if (!rows || rows.length === 0) {
            console.log(`No results found for query '${query}' at offset ${offset}`);
            return { plaques: [], totalCount };
        }

        // Log the first row to understand the structure
        console.log("Sample row from database:", JSON.stringify(rows[0], null, 2));

        // Format the results according to the new response format
        const plaques = rows.map(row => {
            return {
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
                
                // Add cropping coordinates if available
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
            };
        });
        
        // Enhance plaques with multiple image URLs
        const enhancedPlaques = enhancePlaquesWithMultipleImageUrls(plaques);
        
        return { 
            plaques: enhancedPlaques,
            totalCount 
        };
    } catch (error) {
        console.error("Error in queryPlaquesWithText:", error);
        throw error;
    }
}

module.exports = {
    search: functions.https.onRequest(search),
};