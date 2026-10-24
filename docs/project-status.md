# Project status — 24 October 2026

## Completed local milestone

- MERN application: MongoDB replica set, Express/Node API and React/Vite console.
- Persistent task queue, attempts, worker identities, measured metrics, events,
  artifacts and scheduling decisions. Atomic MongoDB transactions and reservations.
- Two outbound-polling authenticated Node workers; real restricted Docker jobs
  for prime computation, CSV grouping/aggregation and PNG/JPEG batch resizing.
- Round robin, least loaded and resource-aware best-fit placement with priority
  aging, eligibility reasons and a persisted decision inspector.
- Heartbeats, execution leases, retry limits/backoff, cancellation, stale-attempt
  fencing, idempotent completion and supervised local startup.
- Overview, workload list/search/filter/pagination, validated creation, workload
  details/results/logs/attempts, compute/worker detail, monitoring, settings and 404.
- Private local artifacts; AWS SDK v3 adapters for encrypted private S3 transfers,
  tagged EC2 discovery and actual CloudWatch CPU data. AWS adapters are not proof
  of live cloud integration.
- Reviewable two-EC2 CloudFormation template, scoped backend IAM policy, worker
  systemd template, network/deployment/security and demonstration documentation.

## Verification evidence

| Check | Observed outcome |
|---|---|
| Backend/integration/container suite | 32 passed; zero failed/skipped |
| React tests | 2 passed |
| Vite production build | Passed; bundled Inter fonts and separate chart bundle |
| Chromium workflow | Real submission, computation, decision inspector, ZIP download and responsive navigation |
| Real HTTP smoke | Five jobs completed; two simultaneous workers and queued work observed; numerical/CSV/image outputs asserted |
| Real daemon recovery | Worker stopped during computation; attempts LOST → COMPLETED on another worker; original daemon restored |
| Known recovery computation | Primes through 5,000,000: 348,513 |
| Frozen installation | Both npm lockfiles reinstalled; verified job image and UI rebuilt |
| Restart persistence | Tasks/results retained; both workers reauthenticated using saved identities |
| Docker Compose config | Parsed successfully |

Smoke/recovery JSON evidence and browser screenshots are under ignored `.local/`.
All numerical/metric displays use actual execution data. No AWS account operations
were performed. CloudFormation/systemd files have not been deployed or validated
on an EC2 host. Test results establish this local instance, not a published snapshot
or restoration in a new cloud task.

## Pending

Live two-instance AWS deployment and verification; authenticated shared MongoDB
deployment; full multi-user authorization/credential lifecycle; artifact/metric
retention; large-scale and multi-node failover/load tests; Experiment Lab;
deadline/cost-aware policy; cost estimates; scaling recommendations; CSV experiment
export; OpenAPI generation; broader browser/accessibility coverage.

The UI does not pretend these modules are complete. Next milestone: operator-
approved AWS deployment and genuine S3/EC2/CloudWatch execution evidence using the
instructions in `aws-setup.md`.
