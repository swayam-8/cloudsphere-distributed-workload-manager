# Real AWS Batch demonstration

This path keeps the React/Express control plane and loopback-only development
MongoDB on the operator's computer, and executes approved workloads in AWS.
It does **not** claim the website/API/database are hosted on EC2. A public/shared
backend deployment still needs authenticated MongoDB, HTTPS and separate hosting.
The local setup saves demonstration credits and does not require a load balancer.

## Current known account and infrastructure

- Region: Stockholm, `eu-north-1`; account `278746617061`.
- Local AWS CLI profile: `cloudsphere`, IAM user `tester`.
- Queue: `CloudSphereJobQueue`; compute: `CloudSphereComputeEnv`.
- User-supplied AWS CLI output confirmed healthy, enabled, managed EC2 compute,
  x86-64, ECS AL2023, minimum/desired 0 and maximum 2 vCPUs.
- User-supplied job-definition listing was empty before this implementation.
- `tester` initially lacked Batch inspection permissions. The supplied read-only
  policy is enough to inspect, not to provision or execute jobs.

The code is implemented and locally tested. Live deployment, account permissions,
network routing, image pulls and an AWS job/result run must be verified in the
actual account. Unit tests and local container tests are not live AWS evidence.

## 1. Inspect without changing anything

Prerequisites: Node 22+, npm, AWS CLI v2, Git, Docker Desktop with Linux containers.
Use the actual repository directory (the one containing package.json). Stop old
CloudSphere terminals with Ctrl+C before starting another launcher.

```powershell
git pull --ff-only origin main
npm ci
npm run aws:inspect -- --profile cloudsphere
npm run aws:deploy -- --profile cloudsphere
```

The first helper records read-only inventory in `.local/aws-inventory.json`.
It sanitizes job-definition environment values. AccessDenied entries identify
missing read permissions without pretending the resources do not exist.

The second command is **read-only unless `--apply` is explicitly supplied**.
It verifies account identity, queue health and managed EC2 compute with minimum
0 / maximum <=2 vCPUs, and prints the support-resource plan. It never changes
existing compute settings or VPC networking. Batch can exceed a configured vCPU
maximum by an instance in some allocation situations; this is not a billing cap.

Account identity is checked against the expected account before other work.
`--account`, `--region`, `--queue`, `--stack`, `--profile` are explicit overrides.
Do not point this at another account without intentionally reviewing that choice.

## 2. Deploy support resources with an authorized deployment identity

An IAM administrator must review `deploy/batch-foundation.yaml` and provide an
identity authorized to deploy it. Do not grant AdministratorAccess to the runtime
user just to bypass errors. A deployment identity needs the specific CloudFormation,
S3, ECR, DynamoDB, CloudWatch Logs and project IAM-role/policy provisioning rights,
plus Batch job-definition registration and PassRole for the created ECS task roles.
The three Batch read actions previously added to tester do not provide these rights.
Use an existing authorized SSO/deployment profile where available; never share keys
in chat or create root access keys.

After review, run under that authorized deployment profile:

```powershell
npm run aws:deploy -- --profile DEPLOYMENT_PROFILE --runtime-profile cloudsphere --apply
```

Replace `DEPLOYMENT_PROFILE` with the actual local authorized profile. If tester
has explicitly been granted the reviewed provisioning rights, use `cloudsphere`.
The script:

1. Rechecks account/queue/compute before any mutation.
2. Deploys a tagged support stack: private encrypted S3, immutable private ECR,
   on-demand DynamoDB audit table, 3-day CloudWatch log group and scoped roles.
3. Builds the fixed Batch image using locked npm dependencies and the existing
   SHA-256-verified Pillow wheel. No AWS credentials/.env files enter the image.
4. Authenticates Docker to ECR using password-stdin (never prints the password).
5. Publishes a versioned image and registers `cloudsphere-approved` pinned by digest.
6. Writes a deployment manifest to private S3 and non-secret local configuration
   into `.local/aws.env` / `.local/aws-resources.json`.

No Batch job or new instance is launched by the support deployment itself.
ECR/S3 storage, logs and other retained data can still incur charges. The script
reuses the existing queue, compute and network; it creates no ALB or NAT gateway.
An x86-64 compute environment requires an amd64 image. Build on the matching Docker
architecture; ARM image publication to this existing environment is not supported.

## 3. Attach the generated runtime policy

The script prints `BackendPolicyArn`, also in `.local/aws-resources.json`.
An IAM administrator must attach that exact generated managed policy to `tester`
(or the intended runtime role). It covers project S3 objects, DynamoDB audit
PutItem/Query, approved Batch submission/cancellation, actual logs, and read-only
compute/metrics inspection. Job and execution roles remain separate.

The deployment helper deliberately does not attach IAM policies to arbitrary users.
Verify account/region, role and backend policy when diagnosing AccessDenied.
Do not replace scoped policies with unrestricted runtime permissions.

## 4. Start the application and test from the frontend

```powershell
npm run dev:aws
```

The launcher installs locked dependencies if needed, starts/reuses the private
local MongoDB, starts Express and React, and verifies the actual AWS account,
queue, active job definition and S3 deployment image manifest. It starts **no
local worker agents** in this mode. Open the console address printed by the
launcher. The loopback demo opens directly without an operator token. Worker
credentials remain private in `.local/dev.env`; hosted/manual API operation
retains operator authentication.

The local database is individual-development-only and bound to loopback. Never
expose it publicly. AWS containers do not contact the local API or MongoDB;
they use a job role to read/write the intended S3 objects.

Open **AWS workspace** from the primary sidebar to see setup status and recent
cloud workloads. **AWS services & console links** contains the eight service links;
**Verify AWS connection** checks core access in AWS mode without launching a job.
Configuration, checked access and recorded execution evidence are distinct.

Frontend demonstration:

1. New workload → CSV processing → **Clean a messy dataset → Use sample**.
2. Configure → **Execution provider: AWS Batch — managed execution**.
3. Keep 1 vCPU; use 512 MB for the initial smoke test and disable automatic retries
   if you want one execution attempt. Inspect the explicit cleaning options.
4. Review and submit. Capacity startup may take several minutes.
5. Open the workload's AWS Batch job link; match the exact job ID in the console.
6. Expand **Cloud execution details** to inspect the recorded image digest, EC2 instance and VPC/subnet observations, actual
   CloudWatch container logs/available CPU observations, and DynamoDB audit trail.
7. Download and extract the ZIP. Expect 7 input rows, 4 retained rows, Books sum
   10300, mean 2575 and one retained IQR outlier. Open report.html and aggregates.csv.

The existing custom scheduling lab remains a worker-policy experiment, not a way
to control AWS Batch's placement. It rejects Batch workloads as custom-policy
sources. Use `npm run dev:all` and open **Advanced → Scheduling lab** for the original two-local-worker experiment path.
Worker and Batch tasks are explicitly separated in the dispatcher.

## 5. Run live acceptance checks

With the AWS demo launcher running, in a second terminal:

```powershell
npm run aws:smoke
```

This explicitly submits **one potentially billable CSV job**, with application
retry count zero. It checks actual processing values, private S3 ZIP download,
DynamoDB completion events and CloudWatch container logs. Evidence is saved to
`.local/aws-smoke-results.json`. It waits up to ten minutes for execution and
requests cancellation of its own unfinished job on failure/timeout. Keep the
backend running until AWS reports the job terminal; a cancellation request alone
does not prove compute has stopped. CPU datapoints can legitimately be absent
for short jobs and are not fabricated.

## AWS Console checklist

| Service | Demonstration evidence |
|---|---|
| Batch | Same job ID as the application, queue, state and execution attempts |
| ECR | Job-definition image pinned to the published repository digest |
| S3 | Original `cloudsphere/<artifact-id>` input; `cloudsphere/batch/<task>/<attempt>/` config, result manifest and ZIP |
| DynamoDB | Audit table keyed by task_id and timestamp/event ID; actual lifecycle records |
| EC2 | Actual instance observed from ECS container placement; may terminate after scale-down |
| VPC | Actual observed instance VPC/subnet and existing compute security groups/routing |
| IAM | Separate backend policy, Batch job role, execution role and existing compute instance profile |
| CloudWatch | Actual container log stream; available AWS/EC2 CPUUtilization datapoints |

## Recovery and integrity

- Batch SubmitJob has no idempotency token. A durable submission intent is written
  before the call; SDK automatic submission retries are disabled.
- Ambiguous outcomes are searched by a UUID-derived job name and linked to the
  existing job. They are never blindly resubmitted. Missing/duplicate matches
  remain visibly unresolved for operator inspection.
- Cancellation races are recovered. Manual retry of a cancelled cloud job is
  blocked until AWS reports the prior job terminal (or confirms no submission
  could have happened before the durable external-call boundary).
- Batch owns execution retries, set to max_retries + 1. One application attempt
  represents the Batch job; its actual Batch sub-attempts remain visible.
- Successful AWS status alone is insufficient: result identity (task, attempt,
  job) and bounded ZIP availability must be verified before completion is attached.
- DynamoDB is an idempotent, recoverable event projection; its outage does not
  cause a second job submission. MongoDB remains the source of truth.
- Original local artifact metadata remains readable in AWS mode; new Batch inputs
  must be uploaded into the current S3 workspace. Cloud downloads in LOCAL mode
  explicitly ask the operator to use AWS mode rather than returning wrong files.
- Do not change account, region or bucket while jobs are active. Configuration
  mismatches are surfaced rather than querying another job silently.

## Local verification (not live AWS)

```sh
npm test
npm run test:ui
npm run build
npm run build:batch
npm run test:batch-image
```

Backend tests require a replica set, configured with CLOUDSPHERE_TEST_MONGODB_URI
when using the combined launcher's 27028 port. The separate image test executes
actual CSV/image/prime kernels in the non-root, network-disabled Batch image with
in-memory S3 fixtures; it does not contact AWS. Browser regressions use the normal
frontend Playwright command.

## After the demonstration

1. Cancel unnecessary queued/running jobs through the app and verify AWS terminal
   states. Keep the backend running long enough to reconcile cancellation/audit.
2. With no queued/running jobs, allow the existing min-vCPU-zero compute environment
   to scale down; verify actual EC2 state. Do not modify its Auto Scaling group.
3. Stop the demo launcher with Ctrl+C. Local MongoDB data is retained.
4. Review Billing for storage/logs/network and delayed charges. Credits are not
   a spending cap; this setup does not automatically stop AWS at credit exhaustion.
5. To remove support infrastructure, first deregister the recorded job definition
   revision and review the stack's resource list. The S3 bucket, ECR repository
   and DynamoDB table intentionally have Retain policies: deleting the stack
   does not delete their data or end their storage charges. Delete those retained
   resources only after backing up anything required and confirming ownership.
6. The pre-existing queue, compute environment, VPC/subnets, IAM instance profile,
   unrelated stopped instances and their EBS disks are not owned or deleted by
   this support stack. Handle their lifecycle separately and deliberately.
