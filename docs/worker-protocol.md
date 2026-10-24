# Outbound worker protocol

All `/api/worker/*` routes except enrollment require an individual bearer token.
`POST /register` requires the enrollment token, a unique name and capacity, and
returns a random individual credential once. Only its SHA-256 digest is stored
in MongoDB. The daemon stores its credential with permissions 0600 and reuses it
after restart. Name collisions cannot take over an existing identity.

1. Heartbeat every two seconds with actual CPU/RAM and active attempt IDs. Only
   owned, current, unexpired RUNNING attempts get lease renewal.
2. `POST /claim` atomically schedules/reserves queued work and returns one job
   for that worker, transitioning its attempt to RUNNING.
3. Fetch `/attempts/:id/input` if needed; run the approved container with limits.
4. Send bounded `/progress` logs. Heartbeats continue independently.
5. POST binary bytes to `/attempts/:id/output`, then POST `/complete` with output
   ID, result, logs and exit code zero. Only that attempt's outputs can attach.
   Identical replays are idempotent; conflicting replays fail with 409.
6. `/fail` records error/exit code. Retry within the limit, delaying
   `backoff_seconds * 2^(attempt_number - 1)`.

Task states: QUEUED → ASSIGNED → RUNNING → COMPLETED, FAILED or CANCELLED.
Failed/lost attempts may return tasks to QUEUED. Attempts additionally have LOST
state. Manual retry creates a new task and preserves original history/limits.

Expired heartbeats mark workers OFFLINE. Expired leases mark attempts LOST and
remove derived reservations. Late heartbeats cannot revive expired attempts.
Result, progress, input and output endpoints fence stale attempts with 409 and
reject other workers with 403. Heartbeats tell daemons to stop cancelled/fenced
attempts; timeout and shutdown also remove the container. Cancellation has a
heartbeat delay.

Execution is **at least once**. A partition can leave old computation alive
until timeout while another worker retries; fencing prevents old output from
committing. Deterministic jobs restart from the beginning. No checkpoints or
exactly-once guarantee are claimed.
