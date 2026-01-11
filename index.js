const HttpTransport = require('./lib/transports/HttpTransport');
const GrpcTransport = require('./lib/transports/GrpcTransport');

/**
 * Normalizes a request path for matching.
 * ... (existing jsdoc)
 */
function normalizePath(req) {
  let path = req.path;
  if (!path && req.url) {
    path = req.url.split('?')[0];
  }
  return path || '/';
}

/**
 * Determines the stream ID for a request based on the configuration.
 * ... (existing jsdoc/logic)
 */
function getStreamId(config, req) {
  const streamIdConfig = config.streamId || process.env.FRKR_STREAM_ID;
  
  if (typeof streamIdConfig === 'function') {
    return streamIdConfig(req);
  }
  
  if (typeof streamIdConfig === 'object' && streamIdConfig !== null) {
    const path = normalizePath(req);
    
    if (streamIdConfig[path] !== undefined) {
      return streamIdConfig[path];
    }
    
    for (const [pattern, streamId] of Object.entries(streamIdConfig)) {
      if (pattern === '*' || pattern === path) continue;
      
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (path === prefix || path.startsWith(prefix + '/')) {
          return streamId;
        }
      }
    }
    
    if (streamIdConfig['*'] !== undefined) {
      return streamIdConfig['*'];
    }
    return null;
  }
  
  if (typeof streamIdConfig === 'string') {
    return streamIdConfig;
  }
  return null;
}

const { Issuer } = require('openid-client');
let tokenCache = { accessToken: null, expiresAt: 0 };
let issuerCache = null;

async function getAccessToken(config) {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  try {
    const issuerUrl = config.issuer || (config.authDomain ? `https://${config.authDomain}` : null);
    if (!issuerUrl) {
      throw new Error('OIDC issuer or authDomain is required');
    }
    if (!issuerCache) {
      issuerCache = await Issuer.discover(issuerUrl);
    }
    const client = new issuerCache.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret
    });
    const audience = config.audience || 'https://api.frkr.io';
    const tokenSet = await client.grant({
      grant_type: 'client_credentials',
      audience: audience
    });

    if (tokenSet.access_token) {
      tokenCache.accessToken = tokenSet.access_token;
      if (tokenSet.expires_in) {
        tokenCache.expiresAt = Date.now() + (tokenSet.expires_in * 1000);
      } else {
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
  // Select Transport
  const transportType = config.transport || process.env.FRKR_TRANSPORT || 'http';
  let transport;
  
  if (transportType === 'grpc') {
    transport = new GrpcTransport(config);
  } else {
    transport = new HttpTransport(config);
  }

  const username = config.username || process.env.FRKR_USERNAME || 'testuser';
  const password = config.password || process.env.FRKR_PASSWORD || 'testpass';
  
  const clientId = config.clientId || process.env.FRKR_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.FRKR_CLIENT_SECRET;

  return async (req, res, next) => {
    const streamId = getStreamId(config, req);
    if (!streamId) {
      if (typeof next === 'function') return next();
      return;
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
        body: req.body ? JSON.stringify(req.body) : '',
        query: req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams),
        timestamp_ns: Date.now() * 1000000,
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
      if (typeof next === 'function') return next();
      return;
    }

    // Send via selected transport (fire and forget)
    transport.send(requestData, authHeader).catch(err => {
      console.error(`Failed to mirror request (${transportType}):`, err.message);
    });

    if (typeof next === 'function') next();
  };
}

module.exports = { mirror };
