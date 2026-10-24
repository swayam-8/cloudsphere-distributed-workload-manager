# Useful workloads and measured scheduling experiments

This milestone implements two complete additions:

1. **CSV quality and analytics:** bounded streaming cleanup, optional duplicate/
   missing-row removal, per-column profiles, grouped statistics using 50-digit Decimal arithmetic,
   optional Tukey IQR outliers, downloadable cleaned/aggregate/outlier CSVs and
   an escaped standalone HTML/JSON report. Include an input SHA-256 and processing
   rules so outputs are reproducible. Keep existing CSV API defaults compatible.
2. **Experiment Lab:** persistent, bounded batches of real approved jobs; freeze
   the policy per task without changing global settings; record worker conditions,
   queue/completion times, makespan, throughput, retries and assignment distribution.
   Compare completed runs only, disclose differing conditions/interference, and
   export actual measurements to CSV. No simulated timings or performance claims.

Validation covers known cleaning/aggregation/outlier fixtures inside the restricted
Docker image, scheduler policy isolation, source reuse, cancellation/CSV metrics,
and real browser uploads/results/experiment comparison. A source fingerprint makes
local startup rebuild stale kernels after a pull. Samples, README, methodology and
demonstration instructions describe actual input/output behavior. Live AWS
verification remains separately pending. See [project status](project-status.md).
