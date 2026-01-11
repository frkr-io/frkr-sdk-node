const grpc = require('@grpc/grpc-js');
const { ingest } = require('@frkr-io/proto');

class GrpcTransport {
  constructor(config = {}) {
    const address = config.ingestGatewayUrl || process.env.FRKR_INGEST_URL || 'localhost:50051';
    // Use insecure for now, can support SSL later via config
    this.client = new ingest.v1.IngestServiceClient(
      address,
      grpc.credentials.createInsecure()
    );
  }

  async send(requestData, authHeader) {
    // requestData matches the plain object structure
    // We need to convert it to the protobuf message if using strict classes,
    // or pass the object if using grpc-js generic methods (which we generated stubs for).
    
    // The generated ingest_pb.IngestRequest matches the structure of requestData:
    // { stream_id: string, request: { method: string, ... } }
    
    // Construct the request object
    const req = new ingest.v1.IngestRequest();
    req.setStreamId(requestData.stream_id);
    
    const mirrorReq = new ingest.v1.MirroredRequest();
    const rd = requestData.request;
    mirrorReq.setMethod(rd.method);
    mirrorReq.setPath(rd.path);
    mirrorReq.setBody(rd.body);
    mirrorReq.setRequestId(rd.request_id);
    mirrorReq.setTimestampNs(rd.timestamp_ns);
    
    // Map headers
    if (rd.headers) {
      const headerMap = mirrorReq.getHeadersMap();
      for (const [k, v] of Object.entries(rd.headers)) {
        // grpc-js headers must be strings
        headerMap.set(k, String(v));
      }
    }
    
    // Map query
    if (rd.query) {
      const queryMap = mirrorReq.getQueryMap();
      for (const [k, v] of Object.entries(rd.query)) {
        queryMap.set(k, String(v));
      }
    }
    
    req.setRequest(mirrorReq);

    // Prepare Metadata
    const metadata = new grpc.Metadata();
    if (authHeader) {
        // authHeader is "Bearer <token>" or "Basic <cred>"
        metadata.add('authorization', authHeader);
    }

    // Send (fire and forget mostly, but we log errors)
    this.client.ingest(req, metadata, (err, response) => {
      if (err) {
        console.error('Failed to mirror request (gRPC):', err.message);
      }
    });
  }
}

module.exports = GrpcTransport;
