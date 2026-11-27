# Gateway

Gateway is the stateless public HTTP edge. It owns authentication, identity
propagation, CORS, rate limiting, request logging, reverse proxying and trace
propagation; it owns no business state or aggregation.

- External routes use `/api/<service-name>/*`. Route by service prefix, strip that
  prefix and proxy the remaining path; never enumerate business endpoints here.
- Preserve canonical W3C `traceparent`, `tracestate` and baggage propagation.
- RUM ingestion is the narrow optional-auth exception:
  `/api/telemetry-server/rum/*` accepts anonymous writes but propagates identity
  when a valid token is present. Do not treat it as a generally public prefix.
- Do not retry proxied or streaming requests: request bodies may be consumed and
  streams may already have observable output. An owning client may retry only
  idempotent, non-streaming connection failures.
- Rate-limit responses and other edge failures use RFC 7807 problem details and
  preserve required headers such as `Retry-After`.
- Runtime server, worker and sandbox roles remain internal-only Gateway targets.

Run `just test backend/gateway`; include auth rejection, optional-auth, streaming
and cancellation coverage when changing middleware or proxy behavior.
