# Initial MongoDB schema / version 1

`backend/store.mjs` initializes collections/indexes idempotently on startup.
There were no pre-existing documents to migrate. Future changes require versioned
migration scripts and backup/rollback guidance; never drop production collections
as an installation step.

Collections: tasks, workers, attempts, decisions, metrics, events, settings,
artifacts and locks. Records use UUID `_id` and `id`; timestamps are UTC ISO 8601
strings with milliseconds. Strict Zod schemas validate the Express boundary.
Worker names/token digests and task/attempt-number pairs have unique indexes.
Snapshot transactions and a dispatch lock protect status/resources. Collection-level
JSON Schema and a full migration framework are not claimed for this milestone.
