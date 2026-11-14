# Project status — 14 November 2026

## Completed local milestone

- MERN application: MongoDB replica set, Express/Node API and React/Vite console.
- Persistent task queue, attempts, worker identities, measured metrics, events,
  artifacts and scheduling decisions. Atomic MongoDB transactions and reservations.
- Two outbound-polling authenticated Node workers; real restricted Docker jobs
  for prime computation, CSV quality/cleaning/grouped statistics and PNG/JPEG batch resizing.
- Round robin, least loaded and resource-aware best-fit placement with priority
  aging, eligibility reasons and a persisted decision inspector.
- Heartbeats, execution leases, retry limits/backoff, cancellation, stale-attempt
  fencing, idempotent completion and supervised local startup.
- Overview, workload list/search/filter/pagination, validated creation, workload
  details/results/logs/attempts, compute/worker detail, monitoring, settings and 404.
- CSV input/output guide with sales, marks, expenses and messy-data samples;
  explicit cleaning rules, quality charts/profiles, IQR flags and downloadable
  cleaned/aggregate/outlier CSVs, standalone HTML and JSON reports with input SHA-256.
- Persistent Scheduling lab batches with pinned policies, actual measurements,
  worker snapshots, comparisons with condition checks and per-job CSV export.
- Source-fingerprinted job images automatically rebuilt after kernel updates.
- Private local artifacts; AWS SDK v3 adapters for encrypted private S3 transfers,
  tagged EC2 discovery and actual CloudWatch CPU data. AWS adapters are not proof
  of live cloud integration.
- Reviewable two-EC2 CloudFormation template, scoped backend IAM policy, worker
  systemd template, network/deployment/security and demonstration documentation.

## Verification evidence

| Check | Observed outcome |
|---|---|
| Backend/integration/container suite | 73 passed; zero failed/skipped, including real CSV cleaning/report contents, source-workload reuse, policy isolation, measured experiment metrics, validation, comparison and cancellation |
| React tests | 12 passed, including sample input/output guidance, matching cleaning rules, upload discovery, file preview, column selection and upload/submission retries |
| Vite production build | Passed; bundled Inter fonts and separate chart bundle |
| Chromium workflows | 5 passed: actual CSV upload/aggregation, messy-data cleaning and report, image resize, CPU benchmark and two-policy experiment comparison/export, with real downloads and mobile overflow checks |
| Real HTTP smoke | Five jobs completed; two simultaneous workers and queued work observed; numerical/CSV/image outputs asserted |
| Real daemon recovery | Worker stopped during computation; attempts LOST → COMPLETED on another worker; original daemon restored |
| Known recovery computation | Primes through 5,000,000: 348,513 |
| Frozen installation | Both npm lockfiles reinstalled; verified job image and UI rebuilt |
| Restart persistence | Tasks/results retained; both workers reauthenticated using saved identities |
| Docker Compose config | Parsed successfully |
| Coexisting MongoDB servers | Local startup and real job/result readiness passed on host port 27028 while the original MongoDB remained running on 27017 |
| One-command launcher | `npm run dev:all` started UI 5199, API 8019, MongoDB 27028 and workers; Chromium submission/result download passed through the matching frontend proxy |
| First-run and cached startup | Combined launcher installed both frozen dependency sets automatically, then reused them after a graceful stop/restart |
| Workstation proxy settings | Full local stack became ready with intentionally unusable HTTP/HTTPS proxy settings; direct API and frontend proxy both returned the same CloudSphere PID |
| Cross-platform automation | Added Ubuntu and Windows GitHub Actions checks for portable startup tests, React tests and UI build; native Windows Docker end-to-end verification remains pending |
| Occupied API and frontend ports | A second complete launch selected free ports, verified its own API through its frontend and completed a real job without stopping the original services |

Smoke/recovery JSON evidence and browser screenshots are under ignored `.local/`.
All numerical/metric displays use actual execution data. No AWS account operations
were performed. CloudFormation/systemd files have not been deployed or validated
on an EC2 host. Test results establish this local instance, not a published snapshot
or restoration in a new cloud task.

## AWS Batch code milestone

- Separate Batch provider with durable submission/reconciliation, cancellation
  fencing, bounded result verification and idempotent DynamoDB audit outbox.
- S3-aware approved container wrapper; locked ECR build/publication and
  digest-pinned job-definition helper; scoped support CloudFormation template.
- Frontend provider selection, actual job identity, logs/audit, recorded EC2/VPC
  placement and genuine CloudWatch datapoints when available.
- One-command AWS demo launcher with local private control plane and cloud
  execution; original local-worker path preserved.
- Separate Batch image smoke test passed for all three actual kernels with S3
  fixtures and real ZIPs. This is not a live AWS account test.
- User CLI output confirmed a healthy existing managed EC2 compute environment
  in Stockholm, min/desired 0, max 2 vCPUs, x86-64. Job definitions were empty.
- Live ECR publication, support deployment, runtime IAM, network/image pulls and
  application-to-AWS execution remain **unverified and pending**. The agent has
  no connected AWS identity; local tester inspection permissions do not deploy.

## Token-free loopback demo

The one-command local and AWS-demo launchers open the workspace directly without
an operator-token screen. The manual/hosted server defaults to token authentication;
worker enrollment and per-worker authentication remain unchanged. The demo requires
an explicit flag, loopback socket peer and loopback Host, and refuses a public bind.
The update passed 35 targeted API/access checks, 12 React tests and a production
build. Anonymous dashboard access and worker rejection were also verified through
the running frontend proxy. Full browser workflows exercise the token-free entry.

## Pending

Live two-instance AWS deployment and verification; authenticated shared MongoDB
deployment; full multi-user authorization/credential lifecycle; artifact/metric
retention; large-scale and multi-node failover/load tests;
deadline/cost-aware policy; cost estimates; scaling recommendations;
OpenAPI generation; broader browser/accessibility coverage.

The UI does not pretend these modules are complete. Next milestone: operator-
approved AWS deployment and genuine S3/EC2/CloudWatch execution evidence using the
instructions in `aws-setup.md`.
