# AWS service integration scope

Actual region: Stockholm (`eu-north-1`), matching the user-created queue and
compute. The user verified local CLI identity tester in account 278746617061.
The last reported estimated credit balance was approximately USD 23; recheck
current applicability and charges. No AWS identity is connected to the managed
agent environment. Integration code is now implemented and locally tested;
live account deployment/acceptance remains pending. See [Batch guide](aws-batch-demo.md).

## Service responsibilities

| Service | Responsibility | Current project support |
|---|---|---|
| AWS Batch | Queue and execute approved CSV/image/CPU container jobs on EC2 compute | Implemented adapter; live execution pending |
| ECR | Store versioned approved job images, referenced by immutable digest | Versioned publication/digest-pinned deployment helper implemented; live publication pending |
| DynamoDB | Queryable AWS job lifecycle/audit records keyed by task and Batch job ID | Recoverable audit outbox, policy/table and timeline implemented; live verification pending |
| S3 | Private inputs and output artifacts | SDK adapter exists; real account execution unverified |
| EC2 | Batch-managed compute capacity; optional separately hosted backend | Existing manual-worker template and discovery adapter; existing managed EC2 Batch compute verified by user; full backend hosting remains separate |
| VPC | Network, routing, subnets and security groups for backend/compute | Existing worker template takes an existing VPC/subnet; existing Batch VPC/subnets are reused; runtime records actual instance networking |
| IAM | Separate backend, Batch execution/job and EC2 instance roles | Initial backend/worker policies exist; scoped Batch/ECR/DynamoDB roles included in support template |
| CloudWatch | Actual job logs and compute CPU observations | EC2 CPU adapter exists; Batch log/compute UI integration implemented; live verification pending |

MongoDB remains the primary application database to preserve MERN. DynamoDB is
an AWS audit projection, not a second competing source of truth for task state.
Audit events use stable IDs and idempotent writes; the durable outbox retries
missed projections without submitting another job.

## Demonstration flow

1. User uploads a CSV through the authenticated Express API to private S3.
2. The backend persists the application task and submits an approved Batch job,
   recording its Batch job ID and immutable image digest.
3. Batch pulls the job image from ECR and runs it on its EC2 compute environment.
4. A scoped job role downloads only the intended input and uploads its result.
   The implemented non-root Batch adapter validates the S3 configuration, runs
   the existing kernels and publishes the verified ZIP before the result manifest.
5. The backend reconciles AWS status, verifies result availability, updates the
   MongoDB task and writes idempotent lifecycle audit records to DynamoDB.
6. The UI shows the real execution provider, Batch job ID/status, result download
   and logs. The presenter matches these to AWS Console resources and metrics.

## Execution semantics

AWS Batch manages placement for Batch jobs. CloudSphere's round-robin,
least-loaded and resource-aware worker policies must remain labelled as its
own worker execution path; they must not be presented as policies controlling
AWS Batch's internal placement. Experiment comparisons must identify the
execution provider and avoid claiming comparable conditions across providers.

Existing LOCAL mode and its verified worker execution remain usable. The
implemented provider additionally requires the deployed queue/definition, private
S3 deployment manifest and audit table. Merely setting CLOUDSPHERE_MODE=AWS is
not evidence of live execution; run the acceptance check after deployment.

## Deployment prerequisites and acceptance

Inventory the account read-only after secure authentication. Select existing
resources where suitable; prepare a concrete resource list, network/HTTPS and
authenticated MongoDB design, region-specific pricing assumptions and cleanup
instructions within the clarified budget. Account credits/free tier are not
assumed. Batch compute may scale to zero; persistent hosts, storage, networking
and logs can still incur charges.

Verify actual ECR image publication, Batch job completion, EC2 identity, S3
result contents, DynamoDB lifecycle records and CloudWatch logs using a known
CSV fixture. Test failure/cancellation/reconciliation as well as success. Do not
mark services integrated merely because empty resources exist in AWS Console.
