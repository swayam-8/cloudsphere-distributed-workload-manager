# AWS setup — live verification pending

No AWS resources have been provisioned or changed. CloudFormation and service
files are reviewable deployment inputs, not evidence of a successful deployment.
Launching the template creates **two billable EC2 instances** and IAM resources.
An operator must review cost, region, network, image, account and IAM changes and
explicitly authorize deployment. There is no automatic deploy/start/stop command.

## Network and data prerequisites

1. Deploy the Express API and built React assets behind one reachable HTTPS
   origin (for example an ALB/reverse proxy and an operator-managed compute host).
   Forward `/api/*` to Express, terminate TLS and restrict operator access. Workers
   require DNS and outbound HTTPS connectivity to this origin; laptop localhost
   is not a reachable backend for EC2.
2. Use authenticated TLS MongoDB Atlas or an operator-managed multi-member
   replica set on private networks. Allow the backend to connect; workers never
   need database access. Store `CLOUDSPHERE_MONGODB_URI` in secure backend settings.
   Enforce backups and test restore. Do not deploy the local unauthenticated Mongo.
3. Create/reuse a private S3 bucket in the selected region. Enable all public
   access blocks, encryption and retention/lifecycle policies. Attach the policy
   in `deploy/backend-policy.json` after substituting the bucket name. The backend
   performs controlled authenticated artifact transfers; worker jobs have no
   network or S3 credentials.
4. Set backend `CLOUDSPHERE_MODE=AWS`, region, S3 bucket, MongoDB URI and distinct
   random operator/enrollment tokens securely. Use an IAM instance/task role for
   AWS SDK access. Run `npm start` with `HOST=0.0.0.0` only behind the restricted
   deployment network/proxy. No credentials belong in the React build.

## Exactly two worker instances

Review `deploy/two-workers.yaml`. Supply an existing VPC/subnet and a supported
Linux AMI that already has Node 22+, npm, curl, Docker and SSM Agent. Select an
instance type with capacity for the configured requests (for example two small
instances for one 256 MB job each; validate actual available host RAM). Confirm
current regional pricing yourself. The template has no inbound worker rules,
enforces IMDSv2 and gives workers an SSM role. Provide NAT or VPC endpoints and
DNS for SSM/HTTPS; the selected subnet must actually have the required routing.

Each instance is tagged `Project=CloudSphere`, `Role=worker`. No SSH port is
needed. Use Session Manager where available. Install the reviewed repository at
`/opt/cloudsphere` on both hosts, create a dedicated `cloudsphere` service user
with Docker access, and run `npm ci` plus `npm run build:jobs` on each. The image
builder downloads a SHA-256-verified Pillow wheel on the host, then installs it
offline in the container. Access to Docker registry/PyPI is needed during setup.

In `/etc/cloudsphere/worker.env` (root-owned mode 0600), set nonempty values:

```dotenv
CLOUDSPHERE_MODE=AWS
CLOUDSPHERE_API_URL=https://YOUR-CONTROL-PLANE
CLOUDSPHERE_ENROLLMENT_TOKEN=SET-SECURELY
CLOUDSPHERE_AWS_REGION=YOUR-REGION
CLOUDSPHERE_INSTANCE_ID=THIS-INSTANCE-ID
CLOUDSPHERE_INSTANCE_TYPE=THIS-INSTANCE-TYPE
CLOUDSPHERE_WORKER_CPU=1
CLOUDSPHERE_WORKER_MEMORY=512
```

Obtain the ID/type from the AWS console or IMDSv2 and verify it matches the actual
host. These metadata fields are operator assertions, not identity attestation.
Never paste real token values into docs/chat. Install the reviewed service:

```sh
sudo install -m 0644 deploy/cloudsphere-worker@.service /etc/systemd/system/
sudo install -d -o cloudsphere -g cloudsphere -m 0700 /var/lib/cloudsphere
sudo systemctl daemon-reload
# On A use worker-a; on B use worker-b.
sudo systemctl enable --now cloudsphere-worker@worker-a
sudo journalctl -u cloudsphere-worker@worker-a --no-pager -n 40
```

Set `.service` Node path if your host does not install Node at `/usr/bin/node`.
The service restarts on crashes and saves its individual token under
`/var/lib/cloudsphere/identity`. Preserve that file to rejoin with the same name.
Do not share a worker state directory between instances.

## Live acceptance checks

Query the authenticated `/api/cloud/instances` endpoint: there must be exactly
the two reviewed project workers, with actual IDs/types/states. Match those IDs
to the registered fleet. Query `/api/cloud/instances/:id/metrics` for genuine
CloudWatch five-minute CPU observations; empty datapoints may be legitimate for
a new instance. Host memory comes from Node `os`, not EC2 default CloudWatch.

Then run the CSV, simultaneous CPU, queue, decision-inspector and approved worker
stop/recovery demonstrations from `demo-script.md`. Download and inspect actual
S3-backed outputs. Restore the stopped service and record timestamps, IDs and
results. These steps are **unverified** until run against an operator-authorized
AWS account. Account access and deployment costs are external prerequisites.

## Troubleshooting

- Empty discovery: verify region, `Project`/`Role` tags, IAM and actual instances.
- 401 enrollment: inspect token binding presence, not logs containing values.
- 409 enrollment: reuse the saved worker credential; don't overwrite identity.
- No heartbeats: check HTTPS DNS/routing/certificate, service logs and API access.
- Queued task: inspect persisted eligibility (capacity/health/job-slot limits).
- Container failure: check Docker permissions/image, request limits and job logs.
- S3 failure: check role, prefix policy, region, encryption policy and bucket access.
- Transaction startup failure: use a replica set/Atlas and valid MongoDB TLS/auth.
