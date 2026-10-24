# Demonstration

## Verified local workflow

1. `npm run dev:all`; authenticate in the console using the private operator token.
2. Show two registered LOCAL workers and real host measurements.
3. Open New workload and explain the input → column selection → output examples.
   Use **Sales by region**: North total 3000 / average 1500, South total 500.
   Follow QUEUED → ASSIGNED/RUNNING → COMPLETED; inspect the chart and download.
   Then use **Clean a messy dataset** with the preselected cleaning rules: 7 rows
   become 4; Books total 10300; the 10000 value is an IQR outlier, not proof of
   fraud. Extract the ZIP; open cleaned.csv, aggregates.csv and report.html.
4. Open the decision inspector. Explain eligibility, reservations, policy score
   and the persisted choice. Change the policy in Settings for future jobs.
5. `npm run smoke`: observe two concurrent CPU jobs and additional queued work.
   Verify prime counts, CSV totals and real resized images. Results persist in
   `.local/smoke-results.json` and the application database.
6. `node scripts/recovery.mjs`: this starts an isolated local API/test database
   and workers, stops its own worker during computation, waits for lease expiry,
   completes on another worker, then restores the stopped daemon. It drops only
   its own uniquely named database and writes `.local/recovery-results.json`.
7. Create/cancel a substantial CPU job; inspect its fenced attempt/history.
8. Open Scheduling lab; run the same small CPU batch under round robin and least
   loaded. Inspect linked workloads, compare finished runs and export measurements.
   Explain queue wait versus completion time, sample counts and host sharing.
9. Show honest AWS-disconnected state in LOCAL mode.

The local workers share a host, so do not describe this demonstration as EC2
execution. The live AWS demonstrations require the deployment/acceptance checks
in `aws-setup.md`, actual account access and approved costs. Scheduling comparisons are local measurements;
deadline/cost scoring and savings claims are not available.
