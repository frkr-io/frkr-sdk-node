# @frkr-io/sdk-node

Node.js SDK for frkr - Mirror API traffic to frkr for testing and replay.

## Overview

The frkr SDK for Node.js provides Express middleware to automatically mirror HTTP requests to frkr. This enables you to:

- **Capture production traffic** for testing and debugging
- **Replay requests** to test different scenarios
- **Route traffic** to different streams based on path patterns
- **Zero impact** on your application (fire-and-forget mirroring)

## Installation

```bash
npm install @frkr-io/sdk-node
```

## Prerequisites

- Node.js 14+
- Express.js (or compatible framework)
- A running frkr instance (or use frkr CLI for local development)
- OIDC Client Credentials (Client ID and Secret) OR Basic Auth credentials
- Supported Frameworks: Express, NestJS, Fastify, Vanilla Node.js

## Usage

The following examples assume Express.js. For other frameworks, see the [Framework Integration](#framework-integration) section.

### Basic Usage (Single Stream)

All requests go to the same stream using OIDC Client Credentials (recommended):

```javascript
const express = require('express');
const { mirror } = require('@frkr-io/sdk-node');

const app = express();
app.use(express.json());

// All requests go to the same stream
app.use(mirror({
  ingestGatewayUrl: 'http://localhost:8082',
  streamId: 'my-api',
  // OIDC Client Credentials
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  authDomain: 'your-auth-domain.com' // Required if issuer is not provided
}));

app.get('/api/users', (req, res) => {
  res.json([{ id: 1, name: 'Alice' }]);
});

app.listen(3000);
```

### Route-Based Stream Routing

Send different API routes to different streams using an object mapping:

```javascript
app.use(mirror({
  ingestGatewayUrl: 'http://localhost:8082',
  streamId: {
    // Exact path matches (highest priority)
    '/api/users': 'users-stream',
    '/api/orders': 'orders-stream',
    
    // Prefix wildcard patterns (e.g., '/api/*' matches '/api/users', '/api/orders', etc.)
    '/api/*': 'api-stream',
    '/admin/*': 'admin-stream',
    
    // Catch-all wildcard (lowest priority, matches any unmatched path)
    '*': 'default-stream'
  },
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET'
}));
```

**Matching Precedence:**
1. **Exact path matches** (e.g., `'/api/users'`) - highest priority
2. **Prefix wildcard patterns** (e.g., `'/api/*'`) - matches paths starting with the prefix
3. **Catch-all wildcard** (`'*'`) - matches any unmatched path - lowest priority

**Examples:**
- Request to `/api/users` → matches `'users-stream'` (exact match)
- Request to `/api/products` → matches `'api-stream'` (prefix wildcard `/api/*`)
- Request to `/admin/users` → matches `'admin-stream'` (prefix wildcard `/admin/*`)
- Request to `/other` → matches `'default-stream'` (catch-all `*`)

**Note:** Path matching is done on the normalized path (query strings are ignored). Trailing slashes are preserved (e.g., `/api/users` and `/api/users/` are different paths).

### Function-Based Routing

Use a function to determine the stream dynamically based on the request:

```javascript
app.use(mirror({
  ingestGatewayUrl: 'http://localhost:8082',
  streamId: (req) => {
    // Custom logic based on request
    if (req.path.startsWith('/api/users')) return 'users-stream';
    if (req.path.startsWith('/api/orders')) return 'orders-stream';
    if (req.method === 'POST') return 'write-stream';
    return 'default-stream';
  },
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET'
}));
```

**Function-based routing has the highest priority** and is evaluated before any object-based routing.

### Environment Variables

All configuration can be provided via environment variables (for single streamId only):

```bash
export FRKR_INGEST_URL="http://localhost:8082"
export FRKR_STREAM_ID="my-api"
# OIDC Credentials
export FRKR_CLIENT_ID="your-client-id"
export FRKR_CLIENT_SECRET="your-client-secret"
export FRKR_AUTH_DOMAIN="your-auth-domain.com"
```

When using environment variables, `streamId` must be a string (single stream). For route-based or function-based routing, use the `streamId` parameter in the configuration object.

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ingestGatewayUrl` | string | `http://localhost:8082` or `FRKR_INGEST_URL` | Ingest Gateway URL |
| `streamId` | string \| object \| function | `FRKR_STREAM_ID` | Stream ID configuration:<br>- **String**: All requests go to this stream<br>- **Object**: Route-based mapping `{ '/path': 'stream-id', '/api/*': 'default', '*': 'catch-all' }`<br>- **Function**: Dynamic routing `(req) => 'stream-id'` |
| `clientId` | string | `FRKR_CLIENT_ID` | OIDC Client ID |
| `clientSecret` | string | `FRKR_CLIENT_SECRET` | OIDC Client Secret |
| `authDomain` | string | - | OIDC Auth Domain (constructs issuer URL) |
| `issuer` | string | - | Full OIDC Issuer URL (overrides authDomain) |
| `audience` | string | `https://api.frkr.io` | API Audience |
| `username` | string | `testuser` or `FRKR_USERNAME` | Basic auth username (Alternative) |
| `password` | string | `testpass` or `FRKR_PASSWORD` | Basic auth password (Alternative) |


## Framework Integration

### NestJS

In your `main.ts` or a global middleware module:

```typescript
import { mirror } from '@frkr-io/sdk-node';

// In main.ts
const app = await NestFactory.create(AppModule);
app.use(mirror({
  ingestGatewayUrl: 'http://localhost:8082',
  streamId: 'nestjs-app',
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET'
}));
await app.listen(3000);
```

### Fastify

Use `@fastify/express` to adapt the middleware, or `midie`:

```javascript
const fastify = require('fastify')();

await fastify.register(require('@fastify/express'));

fastify.use(mirror({
  ingestGatewayUrl: 'http://localhost:8082',
  streamId: 'fastify-app',
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET'
}));

fastify.get('/', (req, reply) => {
  reply.send({ hello: 'world' });
});
```

### Vanilla Node.js

The SDK can be used with a standard `http.createServer`:

```javascript
const http = require('http');
const { mirror } = require('@frkr-io/sdk-node');

const mirrorMiddleware = mirror({
  ingestGatewayUrl: 'http://localhost:8082',
  streamId: 'vanilla-node',
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET'
});

const server = http.createServer((req, res) => {
  // Run middleware manually
  mirrorMiddleware(req, res, () => {
    // Continue with your logic
    res.writeHead(200);
    res.end('Hello World');
  });
});

server.listen(3000);
```

## Configuration Options


## Basic Authentication

If you prefer to use Basic Authentication (e.g. for local development with `frkr-cli`), you can provide `username` and `password` instead of client credentials.

```javascript
app.use(mirror({
  ingestGatewayUrl: 'http://localhost:8082',
  streamId: 'my-api',
  username: 'testuser',
  password: 'testpass'
}));
```

Or via environment variables:
```bash
export FRKR_USERNAME="testuser"
export FRKR_PASSWORD="testpass"
```

## Route Matching Details

### Path Normalization

- Query strings are automatically stripped from paths before matching
- Empty or undefined paths are normalized to `/`
- The SDK uses `req.path` (Express-provided) when available, falling back to `req.url` with query string removed

### Matching Behavior

- **Exact matches** take precedence over wildcard patterns
- **Prefix wildcards** (`/api/*`) match paths that start with the prefix followed by `/` or end with the prefix
- **Catch-all** (`*`) only matches if no other pattern matches
- If no pattern matches and no catch-all is defined, the request is **not mirrored** (middleware continues normally)

### Examples

```javascript
// Example 1: Simple routing
streamId: {
  '/api/users': 'users',      // Exact match
  '/api/*': 'api',             // Prefix wildcard
  '*': 'default'              // Catch-all
}

// Request: /api/users → 'users' (exact match)
// Request: /api/orders → 'api' (prefix wildcard)
// Request: /other → 'default' (catch-all)

// Example 2: Multiple prefix patterns
streamId: {
  '/api/v1/*': 'v1-stream',
  '/api/v2/*': 'v2-stream',
  '/api/*': 'api-stream',      // Fallback for other /api routes
  '*': 'default'
}

// Request: /api/v1/users → 'v1-stream'
// Request: /api/v2/orders → 'v2-stream'
// Request: /api/health → 'api-stream'
// Request: /other → 'default'
```

## Error Handling

The SDK uses a "fire and forget" approach for mirroring requests:
- Mirroring failures are logged to `console.error` but do not affect the original request
- The original request continues normally even if mirroring fails
- This ensures that mirroring never impacts your application's functionality

## Examples

See [frkr-example-api](https://github.com/frkr-io/frkr-example-api) for a complete working example.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

Apache 2.0 - See [LICENSE](LICENSE) file for details.
