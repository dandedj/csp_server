// define a base class to be used by all functions that defines the CORS headers and the BigQuery client
class CloudFunctionUtils {
    // Set CORS headers for the request
    static setCorsHeaders(req, res) {
        res.set('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
            // Send response to OPTIONS requests
            res.set('Access-Control-Allow-Methods', 'GET, POST');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
            res.set('Access-Control-Max-Age', '3600');
            res.status(204).send('');
        }
        else {
            // Set CORS headers for the main request
            res.set('Access-Control-Allow-Origin', '*');
        }
    };
}

module.exports = CloudFunctionUtils;