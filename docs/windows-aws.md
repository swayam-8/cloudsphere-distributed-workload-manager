# Windows to AWS: inventory before deployment

CloudShell is optional. The Windows AWS CLI can inspect and deploy real AWS
resources. Their jobs, images, files and logs appear in the same AWS Console.
Console sign-in alone does not authenticate Node or the CLI. Local commands
also cannot bypass an AWS account activation or account-plan restriction.

## Current implementation and scope

`48ec332` is the existing local milestone. The AWS mode currently changes
artifact storage and provides EC2 discovery/CPU metrics; it does **not** submit
AWS Batch jobs. DynamoDB audit and ECR deployment are also pending.
Do not deploy `deploy/two-workers.yaml` to demonstrate Batch: that template is
for the separate custom-worker execution path.

The new inventory helper is read-only preparation, not a deployment command.
It does not submit jobs, pull images, retrieve workload contents, change IAM,
create infrastructure or verify a successful end-to-end execution.

## 1. Install and sign in privately

Install/update AWS CLI v2 from the official Windows installer:
https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

In a new PowerShell terminal:

```powershell
aws --version
aws login --profile cloudsphere
```

`aws login` requires CLI 2.32.0 or later. Select the intended current account in
your own browser, and use `eu-north-1` when asked for a region. For an IAM user or
federated role the documented `SignInLocalDevelopmentAccess` permission is
required. Do not create long-term access keys to work around a login failure.
IAM Identity Center users should use their organization's `aws configure sso`
and `aws sso login` flow instead. Do not use root as the application's runtime
identity. No passwords, tokens, authorization codes or credential files should
be sent through chat or committed to Git.

Official authentication details:
https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html

Confirm the identity locally:

```powershell
aws sts get-caller-identity --profile cloudsphere --region eu-north-1
```

Check the returned account ID against the account holding the existing
`CloudSphereJobQueue`. Do not switch to another account for extra credits.

## 2. Inspect the existing Stockholm deployment

From the repository folder, after pulling this update:

```powershell
node scripts/aws-inventory.mjs --profile cloudsphere --expected-account YOUR_12_DIGIT_ACCOUNT_ID
```

Replace the placeholder with the account ID verified above. Node 22+ and AWS CLI
are required; installing npm dependencies is not necessary for this helper.
It pins all regional calls to Stockholm and aborts before resource queries if
the authenticated identity is different. It writes `.local/aws-inventory.json`
(ignored by Git). Review before sharing: account IDs, resource ARNs, role/profile
references and network rules are included; credentials, container environment
values, commands and actual workload/log contents are excluded.

The helper inspects:

- The named queue and its linked compute environments (not an assumed duplicate).
- Compute resource type, vCPU bounds, subnets, security groups, routing, and roles.
- Actual ECS container instances and their EC2 IDs/architectures when present.
- Active job definition images/digests, role references, retry and timeout settings.
- Up to 25 job summaries per state; not a complete historical execution export.
- Name-filtered ECR/S3/DynamoDB candidates and Batch log-group metadata.

`unavailable` means a check failed, not that the resource is absent. A queue with
no linked compute environments or an empty job list is not a working integration.
An EC2 compute environment may legitimately have zero instances while idle.
Candidate lists are hints only: names do not establish ownership, image contents,
bucket encryption/privacy, table schema or permissions. Those need targeted
inspection after choosing the actual project resources. The inventory records
role references, not a full IAM policy/security audit.

## 3. Required decisions before launching compute

Review Billing manually for account plan, remaining credits, their expiration
and service applicability, and current charges. The helper intentionally does
not invoke potentially billable Cost Explorer queries. Record an approved
incremental spend limit and demonstration duration. Credits are not a billing
cap. Do not upgrade the account plan as a side effect of running this helper.

Use the inventory to select architecture-compatible ECR images and determine
whether the existing environment is EC2, Spot or Fargate. An ECS queue label alone
does not answer this. If it is Fargate, the requested EC2 demonstration needs an
explicitly reviewed compute change; do not replace it blindly.

Before launch, prepare a regional cost estimate covering instance runtime,
EBS, public IPv4 if applicable, ECR, S3, DynamoDB and CloudWatch. Identify any
existing NAT gateway costs. Avoid creating NAT gateways or load balancers just
for this demo. Define cleanup for only the resources created by this project,
including restoring reviewed Batch capacity settings and verifying termination
of project instances. Never delete unrelated resources or retained user data.

## 4. Next implementation milestone

Preserve the MERN backend and local custom-worker path. Add a separately labelled
Batch provider, a fixed S3-aware job entrypoint, ECR publication pinned by digest,
durable submission/reconciliation/cancellation, verified artifact retrieval and
an idempotent DynamoDB audit projection. The frontend must expose the actual
Batch job identity and provider. Custom scheduling experiments remain on the
custom workers; they do not control Batch's internal placement.

The Windows backend can call AWS APIs over outbound HTTPS. Batch jobs retrieve
their inputs and upload outputs using their scoped role; they must not require
inbound connections to laptop localhost. A local-only operator UI is suitable
for a single-computer demonstration. A shared hosted application requires a
separately reviewed authenticated database and HTTPS/tunnel deployment.

Acceptance is a real browser upload, actual matching Batch job, ECR digest,
EC2 instance evidence, private S3 artifacts, DynamoDB records, CloudWatch logs,
known CSV output assertions and tested failure/cancellation/restart handling.
Until those run, report AWS execution as unverified.
