const axios = require('axios');

class HttpTransport {
  constructor(config = {}) {
    this.ingestGatewayUrl = config.ingestGatewayUrl || process.env.FRKR_INGEST_URL || 'http://localhost:8082';
  }

  async send(requestData, authHeader) {
    try {
      await axios.post(
        `${this.ingestGatewayUrl}/ingest`,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          }
        }
      );
    } catch (err) {
      console.error('Failed to mirror request (HTTP):', err.message);
    }
  }
}

module.exports = HttpTransport;
