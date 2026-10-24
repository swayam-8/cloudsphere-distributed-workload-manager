# Scheduling experiment methodology

The Scheduling lab runs persisted batches of 2–12 real approved jobs using the
normal queue, workers, Docker execution, artifacts and attempt history. It does
not simulate executions or assume any policy performs best. At least two healthy
workers must each fit the job's CPU and memory request. One lab batch may run at
a time; other ordinary workloads may still execute and are flagged as interference.

## Reproduce a comparison

1. Start with `npm run dev:all`, sign in, and open **Scheduling lab**.
2. Select a policy, job count, and mix. Quick CPU cycles limits 100k/200k/400k;
   mixed CPU cycles 500k/1m/2m. Both use 1 vCPU, 256 MB, 180 s and one retry.
   Alternatively repeat a completed workload with its same input, parameters
   and resources. Existing input metadata is reused; every copy has its own task
   and result. The UI lists the 20 most recent completed sources.
3. Let the batch finish. Open its individual workloads to inspect decisions,
   attempts, logs and real outputs. Export per-job CSV measurements.
4. Repeat with the same job count/mix/input/capacities and another policy. Keep
   worker identities stable and unrelated workloads stopped. Use warm-up runs
   and several recorded trials per policy.
5. Select 2–4 finished runs and compare. Different configuration, worker topology,
   environment, overlapping jobs, extra workers or failed/cancelled jobs are
   disclosed; comparison then remains descriptive, not a fair performance claim.

The selected policy is pinned to each experiment task without changing global
settings. The initial eligible-worker snapshot and configuration signature are
persisted. Signatures exclude experiment names/policy, include input identity,
and compare worker IDs, CPU/memory and job slots. New uploads include their SHA-256;
older uploads use artifact identity conservatively. Manual retry creates a separate
ordinary task outside the original experiment. Batch cancellation fences its
active attempts and preserves records.

## Metric definitions

| Metric | Definition |
|---|---|
| Queue wait | Task creation → first worker start; only started jobs enter the mean. |
| Completion time | Task creation → successful terminal completion; includes queuing and retry delay. Failed/cancelled jobs remain visible but do not enter success percentiles. |
| Median / p95 | Sorted successful completion times, interpolated at index `(n − 1) × p`, with sample count. A p95 of two observations is not a reliable tail estimate. |
| Batch time / makespan | Batch creation → final terminal task timestamp. Only available when every expected task is terminal. |
| Throughput | Successfully completed jobs / batch time × 60, jobs per minute. Available only for finished batches with positive duration. |
| Retries | Sum of attempts beyond the first per task; failed/lost attempts are counted separately. |
| Distribution | Assignments and successful attempts per worker, including retries. |
| Host CPU | Mean of actual timestamped worker host-CPU observations during the run, capped at 5,000 observations. Not per-job CPU usage or a time-weighted integration. |

Unobserved values stay blank/null. CSV export contains real task timestamps,
queue/completion duration, attempt count and latest worker identity. No synthetic
timestamps or successful results are generated for failed jobs.

Matching recorded conditions cannot control host background load, polling phase,
image warm-up or cloud variability. Local workers share a physical host, so this
is not evidence of multi-host AWS performance. Persist several trials and report
variation before drawing conclusions; the UI does not declare a winner.

## Still pending

Deadline/cost-aware policy, cost estimates, scaling recommendations and live AWS
deployment verification remain separate milestones. Cost allocation would need
operator-configured region/type/OS/purchase rates and explicit idle/overlap rules;
per-job duration × an hourly rate is not an AWS invoice.
