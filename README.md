# CloudSphere

CloudSphere is an educational distributed workload orchestrator built with
**MongoDB, Express, React and Node.js (MERN)**. Two authenticated Node workers
execute approved CPU, CSV and image jobs in restricted Docker containers.
It implements scheduling policies for study; it does not replace AWS Batch,
ECS or Kubernetes.

**Local execution is implemented and tested. Live AWS deployment is pending.**
AWS SDK v3 adapters, IAM policy, a two-worker EC2 template and a systemd service
are included; those files do not establish that EC2/S3/CloudWatch was deployed.
See [project status](docs/project-status.md) and [AWS setup](docs/aws-setup.md).

## Start everything with one command

Prerequisites: **Node.js 22+** (24 recommended), npm, Git, curl, and a running
Docker Engine using **Linux containers**. Windows users can use PowerShell and
Docker Desktop. A host Python installation and AWS credentials are not needed
for local mode. The fixed container job kernels use Python/Pillow; the application,
API and worker agents use Node/JavaScript.

Open the actual repository folder in VS Code: it contains this README,
`package.json` (name `cloudsphere`), `backend`, `frontend` and `scripts`.
Do not confuse it with a parent folder containing another clone of the same name.

In its terminal run:

```sh
npm run dev:all
```

That single command:

1. Installs **both** backend and frontend dependencies with `npm ci` on first
   launch, missing dependencies, or dependency-file/platform/Node-major changes.
   Later runs reuse the completed installation.
2. Preserves your existing Docker Desktop context and verifies its Linux engine.
3. Builds the approved job image if missing or its source fingerprint changed. Pillow is checked against the
   committed SHA-256 lock and installed offline inside the image.
4. Starts/reuses the project-owned local MongoDB replica set and persistent volume.
5. Starts Express and verifies a real HTTP health response from that exact process.
6. Starts two workers and waits for their authenticated heartbeats.
7. Starts Vite and verifies `/api/health` through its proxy reaches the same API.
8. Prints **CloudSphere is ready** and the console address only after these checks.

Default combined-launcher ports are frontend **5199**, backend **8019** and MongoDB
**27028**. If an API/frontend port is occupied or unavailable, the launcher selects
an OS-assigned free port and wires the workers/proxy to it. Open the **console
address printed by the current run**, which may differ from 5199. It never kills
another project to free a port. It does not silently switch MongoDB databases.

Open the absolute **operator token file** path printed by the command in VS Code
(normally `.local/dev.env`). Copy only the value after `CLOUDSPHERE_OPERATOR_TOKEN=`
into the console login form. This is a bearer credential, not a username/password.
Never share or commit the file or use the enrollment token in the login form.

Keep that terminal open. **Ctrl+C** stops only this launcher's API/frontend/workers.
Startup errors print in the terminal and trigger the same cleanup; a failed
readiness check does not leave its own API running. MongoDB remains running and
its volume/data are retained.

### Pull updates and start (PowerShell)

First stop old CloudSphere terminals with Ctrl+C. From the repository folder:

```powershell
git pull --ff-only origin main; if ($LASTEXITCODE -eq 0) { npm run dev:all }
```

If your terminal is elsewhere, use an absolute path (replace the example):

```powershell
git -C "C:\path\to\cloudsphere-distributed-workload-manager" pull --ff-only origin main; if ($LASTEXITCODE -eq 0) { npm --prefix "C:\path\to\cloudsphere-distributed-workload-manager" run dev:all }
```

The launcher locates its own repository root, so startup does not depend on where
the terminal was opened. `git pull --ff-only` preserves local changes and stops
instead of creating an unexpected merge; the application starts only if it succeeds.
Do not reset or delete local work to make a pull pass.

### Fresh clone

```sh
git clone https://github.com/swayam-8/cloudsphere-distributed-workload-manager.git
cd cloudsphere-distributed-workload-manager
npm run dev:all
```

The first image/dependency download takes longer than a restart. Installation
keeps TLS, package integrity and wheel checksum verification enabled.

## Troubleshooting

| Symptom | Meaning / next step |
|---|---|
| Docker named-pipe/daemon error | Start Docker Desktop and wait for Engine running. `docker info` must include a Server section. Do not reinstall dependencies to solve this. |
| Wrong Docker endpoint | `docker context show` should identify your intended engine. The scripts preserve your context and `DOCKER_CONFIG`. |
| MongoDB port 27028 occupied | Keep the other service running. Choose another `CLOUDSPHERE_MONGO_PORT` as shown below; retain that selection to keep the same dataset. |
| Health timeout / empty reply | The launcher now uses direct loopback HTTP independent of HTTP proxy variables. It reports the last HTTP error and API output, then cleans up its children. Keep that exact output for diagnosis; do not disable TLS or your firewall. |
| Another app opens | Use the current launcher's printed console address, not an old bookmarked port. Both the service name and backend PID must match before startup succeeds. |
| 404 API error | A route/proxy mismatch, not an invalid token. Restart with the combined launcher; the frontend and workers receive the selected API port together. |
| 401 API error | Use the operator token from this checkout's private `.local/dev.env`; disconnect an old browser session before signing in again. |
| No `.local/api.log` in terminal directory | You are outside the actual checkout. The launcher now prints its absolute token-file path; logs are in that same `.local` directory. |
| Worker enrollment name collision | Preserve/reuse the saved worker identity file. Do not overwrite identities to take over another worker. |

To inspect this run without sending a token, read `.local/runtime.json`, which
contains the selected API/console addresses, PID and MongoDB port. It contains no
credentials. `/api/health` through the console must return `service: cloudsphere`.

On Windows, the portable startup/HTTP/process tests are included in the GitHub
Actions Windows matrix. Full EC2 deployment and native Windows Docker end-to-end
behavior must still be verified on those actual hosts; a Linux test is not proof
that a workstation's firewall or port forwarding is configured correctly.

### Select a different MongoDB port (PowerShell)

```powershell
$env:CLOUDSPHERE_MONGO_PORT = "27029"
npm run dev:all
```

Nondefault ports use distinct named containers/volumes, artifacts and worker
identity directories. Keep using the same port for the same development dataset.
The combined default is `cloudsphere-mongo-27028`; stop just that container with
`docker stop cloudsphere-mongo-27028` if needed. Never delete its volume to fix
startup. Old default-27017 data stays in `cloudsphere-mongo-data` untouched.

The local MongoDB instance is **unauthenticated and loopback-only**. It is for
individual development. Use authenticated TLS MongoDB/Atlas with backups and
private networking for a shared or AWS deployment.

## Run actual workloads

1. Choose **New workload** in the sidebar or **Upload & run** on Overview.
2. Choose **CSV processing** (the default), **Image processing**, or **CPU benchmark**.
   CSV/images show a drag-and-drop upload area with a **Browse files** button.
   CSV uploads show the first rows and column names. A sample CSV can be downloaded
   from this screen. CPU benchmarks do not require an input file.
3. Select **Continue**, name the workload and choose processing options. For a CSV,
   choose the grouping column and the numeric column to sum, or count rows only.
4. Review the input, operation and resources, then **Submit workload**. Upload
   progress comes from actual transferred bytes. A failed submission can reuse
   an input that was already uploaded successfully.
5. Follow the workload page from queued to completed. It shows the original input
   filename, result summary, attempts and scheduling decision. **Download results**
   collects the ZIP; logs and raw metadata remain in expandable sections.

### What data goes in, and what comes out?

| Upload | User chooses | Output for the included sample |
|---|---|---|
| Sales: `date, product, region, amount` | Group `region`, analyse `amount` | North total 3,000 / average 1,500; South total 500. |
| Marks: `student, subject, marks` | Group `subject`, analyse `marks` | Math average 80, minimum 70, maximum 90. |
| Expenses: `date, category, amount` | Group `category`, analyse `amount` | Travel total 1,000; Supplies total 200. |
| A supported CSV with only text | Group a column; leave numeric empty | Counts per group, missing/duplicate checks and column profiles. |
| Messy sales sample | Enable duplicate/incomplete removal and skip invalid amounts | 7 rows → 4 retained; Books total 10,300; one IQR outlier flagged and kept. |

Choose **Use sample** on the upload screen to load a dataset and its matching
settings, or upload your own CSV with different column names. Select a numeric
column for sum, mean, min and max. Leave grouping empty for one overall summary.
The app does not infer the business meaning of arbitrary columns.

The results page includes quality measures, grouped charts/tables and column
profiles. **Download results** produces `cleaned.csv`, `aggregates.csv`,
`outliers.csv`, `report.html`, `quality.json` and `result.json`. Cleaning is
explicit, and the report records the chosen rules and original file SHA-256.
Statistical outliers are kept and are not labelled as fraud or proven errors.
See [input/output examples and validation rules](docs/data-workflows.md).

### Compare real scheduling policies

Open **Scheduling lab**, select a policy and a batch of 2–12 jobs, then run it
again under another policy with the same settings. Use built-in CPU mixes or
repeat an existing workload with its same input and processing options. Compare
queue wait, median/p95 completion, batch time, throughput, retries and worker
assignments; export actual per-job measurements to CSV. At least two healthy
workers are required. Conditions that differ or include interfering workloads
are disclosed. See [methodology and metric definitions](docs/experiment-methodology.md).

The upload screen in local mode:

![CSV upload, sample inputs and expected outputs](docs/images/upload-workload.png)

A completed messy-data analysis (real local execution):

![Data quality, grouped statistics and explained result files](docs/images/data-quality-report.png)

- **Prime benchmark:** choose limit 100; the real output must show 25 primes with
  sum 1060. Larger bounded limits exercise CPU contention.
- **CSV aggregation:** upload `examples/sales.csv`, group `category`, numeric
  column `amount`. The ZIP contains cleaned data, grouped statistics, flagged outliers and HTML/JSON reports.
- **Images:** upload `examples/sample.png` and width 64; the 800 x 400 input becomes
  a 64 x 32 thumbnail and manifest. Bounded ZIPs of PNG/JPEG files are supported.

Jobs use a fixed non-root Docker image, CPU/memory/PID limits, no network,
read-only root filesystem, dropped capabilities and an execution timeout.
User shell commands/images/code are not accepted. Input/output passes through
an authenticated backend flow: private local files in LOCAL mode, private S3
objects in AWS mode. Host metrics are actual Node `os` observations; local workers
share the same host and are not presented as EC2 workers.

## Tests and checks

The portable tests require no AWS, database or Docker:

```sh
node --test --test-concurrency=1 tests/bootstrap.test.mjs tests/dev-config.test.mjs tests/local-http.test.mjs tests/local-address.test.mjs tests/runtime.test.mjs
npm run test:ui
npm run build
```

With the combined launcher running, exercise real execution:

```sh
node scripts/check-readiness.mjs
npm run smoke
```

Those helpers read `.local/runtime.json` to use the actual selected API address.
The smoke check submits five real jobs and asserts two-worker parallel execution,
queuing, numerical/CSV/image results and authenticated output downloads.

The complete backend suite (`npm test`) requires a Linux Docker engine and a
MongoDB replica set. It creates/drops uniquely named **test** databases. The local
server can be selected with `CLOUDSPHERE_TEST_MONGODB_URI`; the default test server
uses 127.0.0.1:27017. With the combined launcher's default database, set:

```powershell
$env:CLOUDSPHERE_TEST_MONGODB_URI = "mongodb://127.0.0.1:27028/?replicaSet=rs0&directConnection=true"
npm test
```

Never target production infrastructure for local tests. Real AWS tests require
separate operator approval/access and are not part of local tests. The isolated
failure-recovery script `node scripts/recovery.mjs` uses the local 27017 test
replica set; it stops only workers it creates and retains JSON evidence in `.local`.

Browser test (from `frontend`):

```sh
npx playwright install chromium
npm run test:e2e
```

The browser test reads the current console address from `.local/runtime.json`.
`CLOUDSPHERE_TEST_WEB_URL` explicitly overrides it, and `CLOUDSPHERE_CHROMIUM_PATH`
can select an existing system browser.

## Advanced / AWS deployment

`npm run dev` retains the original 8000/5173/27017 defaults. `--no-frontend` supports
a separately managed console. `CLOUDSPHERE_API_PORT` and `CLOUDSPHERE_WEB_PORT`
select preferred ports. A separately started frontend must receive the same API
port and be restarted if it changes. The combined launcher handles that automatically.

For AWS, use `npm start` with a securely configured `.env` (see `.env.example`),
an IAM backend role, private S3, authenticated MongoDB/Atlas and a reachable HTTPS
origin. Install the worker service on exactly two reviewed EC2 hosts. Local launch
commands always run LOCAL mode and do not create AWS resources. Never put AWS
credentials in React or assume EC2 can reach laptop localhost.

## Documentation

- [Implementation plan](docs/implementation-plan.md) and [project status](docs/project-status.md)
- [Architecture](docs/architecture.md) and [REST API](docs/api.md)
- [Scheduling formulas](docs/scheduling-algorithms.md) and [worker protocol](docs/worker-protocol.md)
- [Security](docs/security.md), [AWS deployment](docs/aws-setup.md) and [demo script](docs/demo-script.md)
- [Data workflows](docs/data-workflows.md): supported inputs, sample answers and downloadable outputs.
- [Experiment methodology](docs/experiment-methodology.md): real policy comparisons, metric definitions and limitations. Cost/deadline scoring and scaling recommendations remain future milestones.
