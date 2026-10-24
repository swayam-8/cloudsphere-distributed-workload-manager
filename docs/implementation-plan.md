# Audit and prioritized development plan

Audit on 24 October 2026: the repository was empty, with no commits, tracked
files, manifests, APIs, routes, models, tests or agent instructions. Git access
succeeded. There was no implementation/design to preserve or existing code in
which to identify bugs. Every requested module was missing.

The application uses **MERN**, following the user's stack choice: MongoDB,
Express, React/Vite and Node.js. Authenticated Node workers poll outbound and
execute fixed Docker kernels. MongoDB transactions serialize dispatch/reservations.
No SQL database, Redis or Python API is required. Approved container kernels use
Python/Pillow; Node controls their lifecycle and the entire application protocol.

1. Build/test the local vertical slice: persistent tasks, two Node workers,
   three real Docker workloads, scheduling explanations, cancellation, leases,
   retries/fencing, useful console and real HTTP/browser checks.
2. Verify AWS: secured API and authenticated MongoDB/Atlas; operator-approved two
   EC2 workers; IAM roles, private S3, read-only EC2/CloudWatch integration; actual
   distributed execution/recovery evidence. Never provision resources automatically.
3. Harden: multi-user ownership, worker credential rotation, retention, rate
   limits, backups, load tests, replica-set failover and deployment security.
4. Add academic features: persisted Experiment Lab batches/comparisons/export,
   deadline/cost-aware scheduling with history/uncertainty, pricing assumptions,
   measured cost allocation and recommendation-only scaling.
5. Polish/present: accessibility, reproducible benchmark methodology and live AWS
   demo recordings. No UI placeholder may be represented as completed functionality.

Run backend tests after engine changes; all three real containers after runtime
changes; UI tests/build after frontend changes; HTTP smoke, real worker recovery
and browser submission/download before completing the local milestone. Record
passed, failed and pending evidence in `project-status.md`.

## Implemented follow-up

The CSV quality/analytics workflow and persisted Scheduling lab with comparisons
and CSV export are now implemented locally. See [data workflows](data-workflows.md),
[experiment methodology](experiment-methodology.md) and current verification in
[project status](project-status.md). The original numbered list above records the
starting plan; remaining AWS/cost/security milestones are still pending.
