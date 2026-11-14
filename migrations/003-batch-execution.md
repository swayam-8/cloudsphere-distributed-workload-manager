# Additive schema: AWS Batch execution

No existing collections are dropped or rewritten. New tasks normalize
execution_provider to workers or aws_batch; historical tasks without the field
remain worker tasks. Worker dispatch explicitly excludes aws_batch.

Batch attempts use SUBMITTING, SUBMISSION_UNKNOWN, BATCH_SUBMITTED and
BATCH_RUNNING states outside the worker lease/reservation state machine. Their
actual Batch job IDs, queue/definition/image/bucket, observed compute and AWS
sub-attempts are persisted. Cancellation confirmation is separate from intent.

Events add an optional audit_pending outbox flag and a supporting index. The
DynamoDB projection uses task_id/event_key; repeated synchronization replaces
that same item rather than creating duplicate executions.

Artifacts add storage_provider and bucket; Batch outputs add s3_key. Historical
artifacts without a provider are treated as local. Inputs must be re-uploaded
into the current AWS bucket before submitting to Batch.

Before rolling back to an older API/scheduler, finish/cancel all Batch jobs and
verify terminal states. An older dispatcher does not understand provider fencing
and could incorrectly claim queued cloud tasks. Back up MongoDB and retained AWS
data; do not delete volumes or collections as an upgrade/rollback step.
