# CloudSphere

An educational distributed workload orchestrator built with **MongoDB, Express,
React and Node.js**, with AWS adapters for EC2, S3 and CloudWatch. It implements
its own scheduling policies for study and comparison; it does not replace AWS
Batch, ECS or Kubernetes.

The first milestone provides real local distributed execution. Live AWS
deployment, the Experiment Lab and deadline/cost-aware scheduling remain pending.
See [project status](docs/project-status.md) and the [audit/plan](docs/implementation-plan.md).

## Local setup

Requirements: Linux, Node.js 22+ (tested on 24), npm, curl and a working Docker
daemon. Allow roughly 2 CPU cores plus MongoDB overhead and 3 GB of disk. Neither
AWS credentials nor a host Python installation are required.

```sh
npm ci
npm ci --prefix frontend
npm run build:jobs
npm run dev
```

The supervisor starts a local MongoDB replica set, Express on port 8000, two
Node worker daemons with one execution slot each, and Vite on port 5173. Read the
operator token from the private `.local/dev.env` file and enter it in the console.
Never share or commit this file. The enrollment token is separate; workers save
individual credentials in `.local/node-workers/` with mode 0600.

Press Ctrl+C to stop API, frontend and worker processes. MongoDB remains running
to preserve local data; `docker stop cloudsphere-mongo` stops that project-owned
container without deleting its named volume. The launcher refuses to reuse an
existing container of that name without the CloudSphere ownership label.

Local MongoDB is **loopback-only and unauthenticated** for development. It must
never be exposed publicly. For shared/AWS deployment use an authenticated, TLS
MongoDB replica set or Atlas and follow [security](docs/security.md).

## Try actual workloads

- **Prime benchmark:** bounded computation; limit 100 produces 25 primes with sum
  1060. Larger limits demonstrate real CPU contention.
- **CSV aggregation:** upload `examples/sales.csv`, group by `category`, sum
  `amount`. Output ZIP contains grouped counts/sums and a JSON report.
- **Images:** upload `examples/sample.png` or a bounded ZIP of PNG/JPEG images.
  Width 64 produces a 64 × 32 thumbnail and manifest from the sample.

Jobs run in a fixed Docker image with no network, dropped capabilities,
non-root UID, read-only root filesystem, CPU/memory/PID limits and hard timeout.
Only approved templates and validated arguments are accepted. The container
kernels use Python/Pillow; all application/worker services use JavaScript/Node.

Uploads/downloads pass through authenticated Express routes. LOCAL stores
private artifact files; AWS mode uses the same controlled flow with private S3
objects. No public buckets or browser AWS credentials are used.

## Validate

With `npm run dev` running in another terminal:

```sh
npm test                   # MongoDB transactions and real Docker execution
npm run test:ui            # React integration tests
npm run build              # Production frontend build
npm run smoke              # Five real jobs, two workers, queue/output assertions
node scripts/recovery.mjs  # Isolated worker stop, expiry, redispatch/restart
```

Browser check:

```sh
cd frontend
npx playwright install chromium
npm run test:e2e
```

To use a system browser, set `CLOUDSPHERE_CHROMIUM_PATH` to its executable.
Backend tests create/drop uniquely named **test databases**, not the development
database. They require a replica set and use Docker; they never call AWS.
`CLOUDSPHERE_TEST_MONGODB_URI` selects a dedicated test server. Do not point local
test workflows at production infrastructure.

## Manual configuration

Copy `.env.example` to `.env`, set distinct random operator/enrollment secrets,
and configure `CLOUDSPHERE_MONGODB_URI`. Run `npm start` and start daemons with:

```sh
npm run worker -- --name worker-a --cpu 1 --memory 512
npm run worker -- --name worker-b --cpu 1 --memory 512
```

The URI must target a replica set/sharded cluster. Standalone MongoDB is rejected.
`npm run dev` manages its own LOCAL configuration; use manual deployment for AWS.

## Documentation

- [Architecture](docs/architecture.md)
- [Scheduling formulas](docs/scheduling-algorithms.md)
- [Worker protocol](docs/worker-protocol.md)
- [AWS setup](docs/aws-setup.md)
- [Security and limits](docs/security.md)
- [Experimental methodology](docs/experiment-methodology.md)
- [Demo script](docs/demo-script.md)
