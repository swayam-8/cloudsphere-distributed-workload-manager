# REST API contract (MERN milestone)

Express listens on port 8000 by default. Application calls are JSON with
`Authorization: Bearer <operator-token>`. Worker tokens are separate. Responses
use UUID IDs and UTC ISO 8601 timestamps. Errors have `{ "detail": "..." }` and
an appropriate 4xx/5xx status; clients must inspect HTTP status.

| Method | Path | Purpose |
|---|---|---|
| GET | /health or /api/health | Unauthenticated database readiness, service identity, process ID and mode |
| POST / GET | /api/tasks | Create validated approved task / paginated list |
| GET | /api/tasks/:id | Task, attempts, decisions and lifecycle events |
| POST | /api/tasks/:id/cancel | Fence active attempts and cancel task |
| POST | /api/tasks/:id/retry | Create new task from failed/cancelled task |
| GET | /api/tasks/:id/attempts | Attempt history |
| GET | /api/tasks/:id/decision | Persisted scheduling explanations |
| GET | /api/tasks/:id/logs | Bounded logs per attempt |
| GET | /api/tasks/:id/output | Authenticated result ZIP download |
| POST | /api/uploads?filename=... | Binary private input upload, maximum 10 MB |
| GET | /api/workers | Real fleet state, reservations and latest host reading |
| GET | /api/workers/:id | Worker metadata and recent attempts |
| GET | /api/workers/:id/metrics | Last 120 timestamped host observations |
| GET | /api/workers/:id/events | Worker events |
| GET | /api/dashboard | Real persisted totals and recent tasks |
| GET | /api/monitoring | Recent metrics, events and current totals |
| GET | /api/events | Last 100 events; optional worker_id filter |
| GET / PUT | /api/settings | Read runtime policy / save algorithm |
| GET | /api/cloud/status | Honest LOCAL/AWS configuration state |
| GET | /api/cloud/instances | Tagged EC2 discovery (empty in LOCAL) |
| GET | /api/cloud/instances/:id/metrics | Genuine CloudWatch CPU for a discovered worker |

Task creation fields: `name`, `kind` (`cpu`, `csv`, `images`), `parameters`, `cpu`
(0.25–64), `memory_mb` (64–65536), `priority` (0–2), `timeout_seconds` (1–3600),
`max_retries` (0–5), optional uploaded `input_id` (required for CSV/images).
CPU parameters: `limit` 100–20000000. CSV: optional `group_by`, `value_column`.
Images: `width` 16–2048. Unknown fields are rejected. Lists accept `q`, `status`,
`page` and `page_size` (maximum 100), ordered newest first.

Enrollment: `POST /api/worker/register` requires the enrollment token and returns
an individual worker token. Heartbeat/claim/progress/input/output/complete/fail
use that individual token; see [worker protocol](worker-protocol.md). Binary input
and output routes use `application/octet-stream`; all protocol metadata is JSON.

Experiment, deadline and cost APIs are not implemented in this milestone. This
contract replaces the Python/FastAPI-specific API documentation assumption in
the original specification; OpenAPI/Swagger generation is future documentation work.
