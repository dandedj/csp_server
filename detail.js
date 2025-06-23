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
        // For Google Cloud Functions, path parameters need to be extracted from the URL
        let id = req.query.id;
        
        // If no query parameter, try to extract from URL path
        if (!id && req.url) {
            const urlParts = req.url.split('/');
            // Look for ID in URL path (e.g., /detail/abc123 or /abc123)
            if (urlParts.length > 1) {
                // Get the last non-empty part of the URL
                id = urlParts[urlParts.length - 1];
                // Remove query string if present
                if (id.includes('?')) {
                    id = id.split('?')[0];
                }
            }
        }
        
        if (!id || id === 'detail') {
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
        
        // Format the result consistently with other endpoints
        const formattedPlaques = rows.map(row => ({
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
        }));
        
        // Enhance with multiple image URLs
        return formattedPlaques.map(enhancePlaqueWithMultipleImageUrls);
        
    } catch (error) {
        console.error('Error querying BigQuery:', error);
        throw error;
    }
}

module.exports = {
    detail: functions.https.onRequest(detail),
};