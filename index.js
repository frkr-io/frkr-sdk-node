const axios = require('axios');

/**
 * Normalizes a request path for matching.
 * - Removes query strings
 * - Normalizes empty/undefined to '/'
 * - Handles both req.path and req.url
 * 
 * @param {Object} req - Express request object
 * @returns {string} Normalized path
 */
function normalizePath(req) {
  // Prefer req.path (Express sets this correctly, excluding query string)
  // Fall back to req.url and strip query string if needed
  let path = req.path;
  if (!path && req.url) {
    // Remove query string from req.url if present
    path = req.url.split('?')[0];
  }
  // Normalize empty/undefined to root
  return path || '/';
}

/**
 * Determines the stream ID for a request based on the configuration.
 * 
 * Matching precedence (for object-based routing):
 * 1. Exact path matches (e.g., '/api/users')
 * 2. Prefix wildcard matches (e.g., '/api/*')
 * 3. Catch-all wildcard ('*')
 * 4. null if no match found
 * 
 * @param {Object} config - SDK configuration
 * @param {Object} req - Express request object
 * @returns {string|null} Stream ID or null if no match
 */
function getStreamId(config, req) {
  const streamIdConfig = config.streamId || process.env.FRKR_STREAM_ID;
  
  // Function-based routing: highest priority
  if (typeof streamIdConfig === 'function') {
    return streamIdConfig(req);
  }
  
  // Object-based routing: route pattern matching
  if (typeof streamIdConfig === 'object' && streamIdConfig !== null) {
    const path = normalizePath(req);
    
    // 1. Check exact path match first (highest priority)
    if (streamIdConfig[path] !== undefined) {
      return streamIdConfig[path];
    }
    
    // 2. Check prefix wildcard patterns (e.g., '/api/*')
    // Iterate in order to respect user-defined precedence
    for (const [pattern, streamId] of Object.entries(streamIdConfig)) {
      // Skip exact matches (already checked) and catch-all
      if (pattern === '*' || pattern === path) {
        continue;
      }
      
      // Check if pattern is a prefix wildcard (ends with '/*')
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        // Match if path starts with prefix
        // Ensure we match whole path segments (e.g., '/api' matches '/api/users' but not '/api2')
        if (path === prefix || path.startsWith(prefix + '/')) {
          return streamId;
        }
      }
    }
    
    // 3. Check catch-all wildcard ('*')
    if (streamIdConfig['*'] !== undefined) {
      return streamIdConfig['*'];
    }
    
    // No match found
    return null;
  }
  
  // String-based routing: all requests go to the same stream
  if (typeof streamIdConfig === 'string') {
    return streamIdConfig;
  }
  
  // No streamId configured
  return null;
}

/**
 * Creates Express middleware for mirroring HTTP requests to frkr.
 * 
 * @param {Object} config - Configuration object
 * @param {string} [config.ingestGatewayUrl] - Ingest Gateway URL (default: 'http://localhost:8082' or FRKR_INGEST_URL)
 * @param {string|Object|Function} [config.streamId] - Stream ID configuration:
 *   - String: All requests go to this stream
 *   - Object: Route-based mapping `{ '/path': 'stream-id', '/api/*': 'default' }`
 *   - Function: Dynamic routing `(req) => 'stream-id'`
 * @param {string} [config.username] - Basic auth username (default: 'testuser' or FRKR_USERNAME)
 * @param {string} [config.password] - Basic auth password (default: 'testpass' or FRKR_PASSWORD)
 * @returns {Function} Express middleware function
 */
const { Issuer } = require('openid-client');

// Token cache
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

// Issuer cache to avoid rediscovery on every request
let issuerCache = null;

/**
 * Fetches an access token using Client Credentials grant with openid-client.
 * 
 * @param {Object} config - SDK configuration
 * @returns {Promise<string>} Access token
 */
async function getAccessToken(config) {
  // Return cached token if valid (with 60s buffer)
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  try {
    // 1. Discover Issuer (if not cached)
    // Prefer 'issuer' config, fall back to 'authDomain' construction
    const issuerUrl = config.issuer || (config.authDomain ? `https://${config.authDomain}` : 'https://dev-frkr.us.auth0.com');
    
    if (!issuerCache) {
      issuerCache = await Issuer.discover(issuerUrl);
    }

    // 2. Create Client
    const client = new issuerCache.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret
    });

    // 3. Grant Client Credentials
    const audience = config.audience || 'https://api.frkr.io';
    const tokenSet = await client.grant({
      grant_type: 'client_credentials',
      audience: audience
    });

    // 4. Cache Token
    if (tokenSet.access_token) {
      tokenCache.accessToken = tokenSet.access_token;
      // expires_in is in seconds
      if (tokenSet.expires_in) {
        tokenCache.expiresAt = Date.now() + (tokenSet.expires_in * 1000);
      } else {
        // Default to 1 hour if not provided
        tokenCache.expiresAt = Date.now() + 3600000;
      }
      return tokenSet.access_token;
    }
    
    throw new Error('No access_token received from provider');

  } catch (err) {
    console.error('Failed to fetch access token:', err.message);
    throw err;
  }
}

function mirror(config = {}) {
  const ingestGatewayUrl = config.ingestGatewayUrl || process.env.FRKR_INGEST_URL || 'http://localhost:8082';
  const username = config.username || process.env.FRKR_USERNAME || 'testuser';
  const password = config.password || process.env.FRKR_PASSWORD || 'testpass';
  
  // M2M Config
  const clientId = config.clientId || process.env.FRKR_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.FRKR_CLIENT_SECRET;

  return async (req, res, next) => {
    // Determine stream ID for this request
    const streamId = getStreamId(config, req);
    
    // Skip mirroring if no streamId found
    if (!streamId) {
      return next();
    }

    // Capture request data
    const path = normalizePath(req);
    const requestData = {
      stream_id: streamId,
      request: {
        method: req.method,
        path: path,
        headers: req.headers,
        body: req.body ? JSON.stringify(req.body) : '',
        query: req.query || {},
        timestamp_ns: Date.now() * 1000000, // nanoseconds
        request_id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      }
    };

    // Build auth header
    let authHeader;
    try {
      if (clientId && clientSecret) {
        const token = await getAccessToken({ ...config, clientId, clientSecret });
        authHeader = `Bearer ${token}`;
      } else {
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        authHeader = `Basic ${credentials}`;
      }
    } catch (err) {
      // If auth fails, we probably shouldn't block the main request, but we can't mirror.
      // We already logged the error in getAccessToken if it failed there.
      return next();
    }

    // Send to Ingest Gateway (fire and forget)
    axios.post(
      `${ingestGatewayUrl}/ingest`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        }
      }
    ).catch(err => {
      // Log but don't fail the request
      console.error('Failed to mirror request:', err.message);
    });

    // Continue with normal request handling
    next();
  };
}

module.exports = { mirror };
