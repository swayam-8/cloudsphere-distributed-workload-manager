# Experiment methodology (future milestone)

The Experiment Lab UI, persisted batch/experiment records, CSV comparisons,
deadline/cost-aware policy and cost-estimation section are not implemented yet.
Current smoke/recovery scripts validate functionality; they are not statistical
evidence that one scheduling policy is better.

For the experiment milestone, fix the worker types, capacity, workload inputs,
job limits, scheduling policy and environment. Submit the same bounded job mix
for each policy under comparable load; include warm-up and repeated trials.
Persist configuration, worker snapshots, attempts, timestamps and actual metrics.

Compute queue delay from task creation to first start, completion duration from
creation to terminal completion, makespan from batch submission to final finish,
throughput as completed jobs/makespan, failure/retry counts and assignment split.
Report median and p95 with the sample count and percentile definition. Separate
host utilization from container process CPU time. Failed/incomplete runs must
remain visible rather than disappearing from averages.

Cost allocation needs operator-configured regional/type/OS/purchase hourly rates.
Per-job duration × hourly rate / 3600 is an allocation assumption, not the AWS
invoice; idle instances still cost money and overlapping jobs need a documented
allocation rule. Do not assert savings without measured comparable runs.
