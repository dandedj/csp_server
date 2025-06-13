// define a base class to be used by all functions that defines the CORS headers and the BigQuery client
class CloudFunctionUtils {
    // Set CORS headers for the request
    static setCorsHeaders(req, res) {
        // Allow requests from specific origins
        const allowedOrigins = ['https://csp-plaques.web.app', 'http://localhost:3000', 'http://localhost:5000'];
        const origin = req.headers.origin;
        
        if (allowedOrigins.includes(origin)) {
            res.set('Access-Control-Allow-Origin', origin);
        } else {
            // For development purposes, you can keep the wildcard
            res.set('Access-Control-Allow-Origin', '*');
        }
        
        if (req.method === 'OPTIONS') {
            // Send response to OPTIONS requests
            res.set('Access-Control-Allow-Methods', 'GET, POST');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
            res.set('Access-Control-Max-Age', '3600');
            res.status(204).send('');
        }
    };
}

module.exports = CloudFunctionUtils;