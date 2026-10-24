"""Bounded CSV quality analysis. Exact Decimal aggregates; explicit statistical rules."""
import csv
import hashlib
import html
import json
import math
from collections import defaultdict
from decimal import Decimal, InvalidOperation, getcontext

getcontext().prec = 50


def number(value):
    if len(value) > 128:
        raise ValueError("Numeric cells must be at most 128 characters")
    try:
        result = Decimal(value)
    except (InvalidOperation, ValueError):
        raise ValueError("Numeric column contains a non-numeric value") from None
    if not result.is_finite() or abs(result) > Decimal("1e20"):
        raise ValueError("CSV numeric value is not finite or exceeds bounds")
    if abs(result.as_tuple().exponent) > 1000:
        raise ValueError("Numeric exponent exceeds supported precision bounds")
    return result


def safe_cell(value):
    value = str(value)
    if value.lstrip().startswith(("=", "+", "-", "@")):
        try:
            number(value)
        except ValueError:
            return "'" + value
    return value


def quantile(values, fraction):
    position = (len(values) - 1) * fraction
    lower = math.floor(position)
    return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (position - lower)


def analyze(parameters, source, output):
    p = {"group_by": "", "value_column": "", "trim_whitespace": True, "deduplicate": False,
         "drop_missing": False, "invalid_numeric": "fail", "detect_outliers": True, **parameters}
    groups = defaultdict(lambda: {"count": 0, "sum": Decimal(0), "min": None, "max": None})
    seen, values, profiles = set(), [], []
    counters = {"input_rows": 0, "retained_rows": 0, "duplicates_found": 0, "duplicates_removed": 0,
                "missing_rows": 0, "missing_cells": 0, "missing_rows_removed": 0, "invalid_rows_removed": 0}
    with source.open(newline="", encoding="utf-8-sig") as handle, (output / "cleaned.csv").open("w", newline="", encoding="utf-8") as clean_handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames
        if not headers or len(headers) > 200 or any(not h.strip() or len(h) > 80 for h in headers) or len(set(headers)) != len(headers):
            raise ValueError("CSV requires 1–200 unique nonempty column names, each at most 80 characters")
        if any(field and field not in headers for field in (p["group_by"], p["value_column"])):
            raise ValueError("Requested CSV column does not exist")
        profiles = [{"column": h, "missing": 0, "numeric_count": 0, "text_count": 0,
                     "sum": Decimal(0), "min": None, "max": None} for h in headers]
        writer = csv.writer(clean_handle)
        writer.writerow([safe_cell(h) for h in headers])
        for row in reader:
            counters["input_rows"] += 1
            if counters["input_rows"] > 1000000:
                raise ValueError("CSV exceeds one million rows")
            if None in row or None in row.values():
                raise ValueError(f"CSV data row {counters['input_rows']} does not match the header width")
            cells = [row[h].strip() if p["trim_whitespace"] else row[h] for h in headers]
            row = dict(zip(headers, cells))
            missing = sum(not v.strip() for v in cells)
            counters["missing_cells"] += missing
            counters["missing_rows"] += bool(missing)
            fingerprint = hashlib.sha256(json.dumps(cells, ensure_ascii=False, separators=(",", ":")).encode()).digest()
            duplicate = fingerprint in seen
            seen.add(fingerprint)
            counters["duplicates_found"] += duplicate
            if p["drop_missing"] and missing:
                counters["missing_rows_removed"] += 1
                continue
            if p["deduplicate"] and duplicate:
                counters["duplicates_removed"] += 1
                continue
            numeric = None
            if p["value_column"]:
                try:
                    numeric = number(row[p["value_column"]].strip())
                except ValueError as exc:
                    if p["invalid_numeric"] == "skip":
                        counters["invalid_rows_removed"] += 1
                        continue
                    raise ValueError(f"Column {p['value_column']!r}, data row {counters['input_rows']}: {exc}") from None
            key = row[p["group_by"]] if p["group_by"] else "all"
            if len(key) > 200:
                raise ValueError("Grouping values must be at most 200 characters")
            if key not in groups and len(groups) >= 10000:
                raise ValueError("CSV exceeds ten thousand groups")
            group = groups[key]
            group["count"] += 1
            if numeric is not None:
                group["sum"] += numeric
                group["min"] = numeric if group["min"] is None else min(group["min"], numeric)
                group["max"] = numeric if group["max"] is None else max(group["max"], numeric)
                if p["detect_outliers"]:
                    values.append(float(numeric))
            counters["retained_rows"] += 1
            writer.writerow([safe_cell(v) for v in cells])
            for profile, cell in zip(profiles, cells):
                if not cell.strip():
                    profile["missing"] += 1
                    continue
                try:
                    n = number(cell.strip())
                except ValueError:
                    profile["text_count"] += 1
                    continue
                profile["numeric_count"] += 1
                profile["sum"] += n
                profile["min"] = n if profile["min"] is None else min(profile["min"], n)
                profile["max"] = n if profile["max"] is None else max(profile["max"], n)

    aggregates = []
    with (output / "aggregates.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["group", "count", "sum", "mean", "min", "max"])
        for key, data in sorted(groups.items()):
            entry = {"group": key, "count": data["count"], "sum": str(data["sum"]) if p["value_column"] else None,
                     "mean": str(data["sum"] / data["count"]) if p["value_column"] else None,
                     "min": str(data["min"]) if data["min"] is not None else None,
                     "max": str(data["max"]) if data["max"] is not None else None}
            aggregates.append(entry)
            writer.writerow([safe_cell(entry[k]) if entry[k] is not None else "" for k in ["group", "count", "sum", "mean", "min", "max"]])

    outliers = {"method": "Tukey IQR, 1.5 × IQR", "available": False, "count": 0,
                "reason": "Outlier detection is disabled." if not p["detect_outliers"] else "Select a numeric column and retain at least four numeric rows to calculate outliers."}
    outlier_column = "__cloudsphere_outlier_reason"
    while outlier_column in headers:
        outlier_column = "_" + outlier_column
    with (output / "outliers.csv").open("w", newline="", encoding="utf-8") as out_handle:
        writer = csv.writer(out_handle)
        writer.writerow([safe_cell(h) for h in headers] + [outlier_column])
        if len(values) >= 4:
            values.sort()
            q1, q3 = quantile(values, .25), quantile(values, .75)
            lower, upper = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
            outliers.update(available=True, reason=None, lower_bound=lower, upper_bound=upper, q1=q1, q3=q3)
            with (output / "cleaned.csv").open(newline="", encoding="utf-8") as handle:
                reader = csv.reader(handle)
                next(reader)
                index = headers.index(p["value_column"])
                for row in reader:
                    value = float(number(row[index]))
                    if value < lower or value > upper:
                        outliers["count"] += 1
                        writer.writerow(row + [f"Outside [{lower:.6g}, {upper:.6g}]"])

    for profile in profiles:
        count = profile["numeric_count"]
        profile["type"] = "mixed" if count and profile["text_count"] else "number" if count else "text" if profile["text_count"] else "empty"
        profile["mean"] = str(profile["sum"] / count) if count else None
        for field in ("sum", "min", "max"):
            profile[field] = str(profile[field]) if profile[field] is not None else None
    cells_total = counters["input_rows"] * len(headers)
    cleaned_total = counters["retained_rows"] * len(headers)
    counters.update(column_count=len(headers), completeness_percent=round(100 * (1 - counters["missing_cells"] / cells_total), 2) if cells_total else None,
                    cleaned_completeness_percent=round(100 * (1 - sum(p["missing"] for p in profiles) / cleaned_total), 2) if cleaned_total else None)
    digest = hashlib.sha256()
    with source.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    top = sorted(aggregates, key=lambda g: float(g["sum"]) if p["value_column"] else g["count"], reverse=True)[:20]
    result = {"analysis_version": 2, "record_count": counters["input_rows"], "cleaned_count": counters["retained_rows"],
              "group_count": len(groups), "numeric_column": p["value_column"] or None, "quality": counters,
              "groups": top, "profiles": profiles[:20], "profile_columns_total": len(profiles),
              "outliers": outliers, "input_sha256": digest.hexdigest(), "rules": p,
              "output_files": ["cleaned.csv", "aggregates.csv", "outliers.csv", "quality.json", "report.html", "result.json"]}
    full = {**result, "groups": aggregates, "profiles": profiles}
    (output / "quality.json").write_text(json.dumps(full, indent=2), encoding="utf-8")
    escaped = lambda value: html.escape("Not available" if value is None else str(value))
    rows = "".join(f"<tr><td>{escaped(g['group'])}</td><td>{g['count']}</td><td>{escaped(g['sum'])}</td><td>{escaped(g['mean'] or '—')}</td></tr>" for g in top)
    notes = "".join(f"<li>{escaped(key.replace('_', ' '))}: <strong>{escaped(value)}</strong></li>" for key, value in counters.items())
    report = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CloudSphere data report</title>
<style>body{{font:15px system-ui;max-width:1000px;margin:48px auto;padding:0 24px;color:#25354a}}h1{{font-size:30px}}small{{color:#65758a}}table{{border-collapse:collapse;width:100%;margin:24px 0}}td,th{{text-align:left;padding:12px;border-bottom:1px solid #dde4ee}}th{{background:#f1f5fa}}li{{margin:9px 0}}code{{overflow-wrap:anywhere}}footer{{margin-top:40px;border-top:1px solid #dde4ee;padding-top:20px}}</style>
<h1>Data quality &amp; aggregation report</h1><p>Generated from actual uploaded records by CloudSphere.</p><h2>Quality and cleaning</h2><ul>{notes}</ul>
<h2>Top groups</h2><p>Largest 20 groups by {'numeric sum' if p['value_column'] else 'row count'}. The complete data is in aggregates.csv.</p><table><tr><th>Group</th><th>Rows</th><th>Sum</th><th>Mean</th></tr>{rows}</table>
<h2>Outlier rule</h2><p>{escaped(outliers['method'])}: {outliers['count']} flagged rows. {escaped(outliers['reason'] or 'Fences: ' + str(outliers.get('lower_bound')) + ' to ' + str(outliers.get('upper_bound')))} Statistical outliers are not proof of errors or fraud.</p>
<h2>Processing rules</h2><pre>{escaped(json.dumps(p, indent=2))}</pre><footer><p>Input SHA-256: <code>{digest.hexdigest()}</code></p><small>Whitespace handling, duplicate detection and missing-row removal follow the selected rules. Numeric IQR fences use floating-point interpolated quartiles; aggregates use Decimal. CSV formula guards may prefix text cells with an apostrophe. No AI inference is used.</small></footer></html>'''
    (output / "report.html").write_text(report, encoding="utf-8")
    print(f"Analyzed {counters['input_rows']} records; retained {counters['retained_rows']}; {outliers['count']} IQR outliers", flush=True)
    return result
