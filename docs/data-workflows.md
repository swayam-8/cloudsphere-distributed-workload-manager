# What users upload and what they receive

CloudSphere runs defined processing jobs on uploaded files. For CSVs, the user
chooses a grouping column and an optional numeric column. Column names can be
arbitrary; the app does not infer their business meaning.

## Practical examples

| Input | Question / selected columns | Actual output for the supplied sample |
|---|---|---|
| [sales-by-region.csv](../examples/sales-by-region.csv): date, product, region, amount | Group `region`, analyse `amount` | North: 2 rows, sum 3000, mean 1500, min 1000, max 2000. South: 1 row, sum/mean/min/max 500. |
| [student-marks.csv](../examples/student-marks.csv): student, subject, marks | Group `subject`, analyse `marks` | Math: 2 rows, mean 80, min 70, max 90. Science: 1 row, mean 85. No pass-rate claim is made. |
| [expenses.csv](../examples/expenses.csv): date, category, amount | Group `category`, analyse `amount` | Travel sum 1000; Supplies sum 200. Currency is not inferred. |
| Any supported text-only CSV | Select a grouping column; leave numeric selection empty | Counts per distinct group, quality checks and text/number/mixed/empty column profiles. No numeric sums or means are invented. |
| [sales-quality.csv](../examples/sales-quality.csv) | Group `category`, analyse `amount`; remove duplicates/incomplete rows; skip invalid numeric rows | 7 input rows → 4 retained; 1 duplicate, 1 incomplete and 1 invalid numeric row removed. Books count 4, sum 10300, mean 2575. The value 10000 is flagged by the IQR rule but retained. |

The upload screen has **Use sample** buttons that load these exact datasets and
their matching settings. Download buttons let users inspect/edit the raw inputs.
For an unfamiliar CSV, preview its headers, decide the question, then choose the
columns. Leave grouping empty for one overall summary. Numeric summaries are
computed over retained rows, after selected cleaning rules.

## Every CSV job produces a results ZIP

| File | Contents / intended use |
|---|---|
| `cleaned.csv` | All retained rows. Optional trimming, duplicate removal and empty-row removal follow explicit user choices. |
| `aggregates.csv` | One row per group: group, count, sum, mean, min, max. Numeric fields are blank when no numeric column is selected. |
| `outliers.csv` | Rows outside the selected numeric column's global 1.5 × IQR fences, plus the reason. Header-only when unavailable or no rows are flagged. |
| `report.html` | Self-contained browser report with quality counts, top 20 groups, rules and input fingerprint. No external service needed. |
| `quality.json` | Complete group results and column profiles, quality counts, selected rules, outlier bounds and input SHA-256. |
| `result.json` | Bounded UI summary, task identity and measured execution timings. |

The results page shows input/retained row counts, cell completeness before/after,
removal reasons, a grouped chart/table, column profiles and outlier explanation.
UI summaries show the top 20 groups and first 20 columns; downloads contain all.
The original input stays unchanged.

## Validation and statistical boundaries

- UTF-8 (optional BOM), comma-separated data with a header, maximum 10 MB.
  Excel workbooks must be saved as CSV. PDF, JSON and arbitrary binary files are
  not CSV inputs. A `.csv` extension alone does not make invalid content valid.
- 1–200 unique nonempty headers, each at most 80 characters. Every data row must
  match the header width; at most one million rows and ten thousand groups.
- Numeric values must be finite, within ±10²⁰, and free of currency symbols and
  locale formatting. Selected nonnumeric/empty numeric cells fail the job by
  default; explicit **skip** mode removes those rows and reports their count.
- Cleaning order: optional trim; detect blanks/duplicates; optional removal of
  incomplete rows, then duplicates, then invalid selected numeric rows. Each
  removed row belongs to one removal category. Duplicate checks compare whole
  rows after optional trimming, preserving original row order.
- Column types describe retained cell values. A missing value is a whitespace-only
  or empty cell; strings such as `NA` are text, not automatically missing.
  Completeness is nonempty cells / all cells, not a measure of correctness.
- Decimal sums use 50-digit arithmetic precision. Means may be rounded repeating
  decimals. UI values are rounded for display; CSV/JSON preserve computed precision.
- Outliers use linearly interpolated Q1/Q3, fences Q1 − 1.5 × IQR and Q3 + 1.5 ×
  IQR, across the selected column, not separately within each group. At least
  four retained numeric rows are required. Fences use floating-point arithmetic.
  Flagging never removes a row and does not establish an error or fraud.
- Exported CSV text that looks like a spreadsheet formula is prefixed with an
  apostrophe. HTML is escaped. Total uncompressed results are limited to 32 MB,
  compressed ZIPs to 10 MB, control-plane metadata to 64 KB; jobs exceeding these
  bounds fail with an explicit error. Very large/wide inputs may need more worker
  memory than the default 256 MB or smaller batches.

The system does not infer currency, units, date semantics, pass/fail thresholds,
attendance percentages, forecasts, correlations or business decisions. These
would require additional, explicitly defined processing templates.

## Other supported workloads

Images: upload PNG/JPEG or a ZIP of up to 100 supported images and select the
maximum size. Receive PNG thumbnails preserving aspect ratio, a manifest mapping
input names to dimensions/output files, and execution metadata.

CPU benchmark: no uploaded file; select a prime-number limit. Receive the actual
prime count, checksum and execution timings. This exercises scheduling rather
than analysing a user's document.

Scheduling lab: submit a bounded real job batch, repeat under a different policy,
and compare persisted timings, assignments and retries. See
[experiment methodology](experiment-methodology.md).
