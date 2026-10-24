# Additive schema: CSV analytics and scheduling experiments

No destructive migration or data reset is required. `Store.connect` idempotently
creates `experiments` and its `{status:1, created_at:-1}` index on startup.
Back up MongoDB before upgrading a shared deployment as usual.

- New `experiments` records store task IDs, initial eligible-worker snapshots,
  algorithm, mix, input identity, configuration signatures and lifecycle times.
- Tasks in a batch add optional `experiment_id` and `scheduling_algorithm`.
  Existing tasks omit both and retain the configured global-policy behavior.
- New input artifacts include `sha256`. Older input artifacts remain readable;
  experiment comparisons conservatively use their artifact identity.
- New CSV tasks normalize cleaning/outlier options. The kernel supplies defaults
  for older tasks. Existing CSV result metadata remains supported by the UI;
  new results add `analysis_version:2` and quality/report fields.

To roll back the UI/API to the earlier version, first finish/cancel active
experiments. The older scheduler would ignore pinned policies on remaining
queued jobs. Do not remove experiment records or rewrite historical results.
Rebuild the matching job image when changing kernel versions. The current local
launcher does this automatically from a source fingerprint; remote workers must
be built/deployed with the same approved source.
