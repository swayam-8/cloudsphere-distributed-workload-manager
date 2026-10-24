# Scheduling policies

Eligibility is identical for all policies: fresh heartbeat, unreserved CPU and
RAM at least the request, and fewer reserved jobs than `max_parallel`. CPU/RAM
reservations sum requests of ASSIGNED and RUNNING attempts in the transaction.

- **Round robin:** sort eligible worker names; select the first after the saved
  cursor, wrapping when needed. Persist the cursor in the same transaction.
- **Least loaded:** minimize `(host_load + reserved_cpu / cpu_capacity +
  reserved_memory / memory_capacity) / 3`, where `host_load =
  (latest_host_cpu_percent + latest_host_memory_percent) / 200`. Ties use name.
  A newly enrolled worker without observations has host load zero until its
  heartbeat; normal daemons heartbeat before claiming. Offline workers are
  ineligible regardless of score.
- **Resource aware:** minimize `((free_cpu - requested_cpu) / cpu_capacity +
  (free_memory - requested_memory) / memory_capacity) / 2`. This best-fit policy
  packs eligible capacity; it does not claim to always reduce latency.

Queue order is descending `priority + floor(wait_seconds / 60)`, then creation
time and UUID. Low-priority jobs eventually overtake newly arriving high-priority
jobs. Infeasible jobs stay queued without blocking smaller eligible jobs.

Persist each assignment's candidate snapshot, free/reserved resources, score,
rejection reasons, policy, chosen worker and timestamp. Deduplicate unchanged
no-capacity decisions. The inspector reads these records directly.

Deadline/cost-aware placement is a later milestone. No deadline guarantee,
pricing advantage or policy performance superiority is asserted.
