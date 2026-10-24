"""Fixed, bounded job templates. No input is ever evaluated as code or a command."""
import argparse
import csv
import io
import json
import math
import time
import zipfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path


def cpu(parameters, source, output):
    limit = parameters["limit"]
    count, checksum = 0, 0
    for candidate in range(2, limit + 1):
        if candidate == 2 or (candidate % 2 and all(candidate % divisor for divisor in range(3, math.isqrt(candidate) + 1, 2))):
            count += 1
            checksum += candidate
    return {"limit": limit, "prime_count": count, "prime_sum": checksum}


def csv_job(parameters, source, output):
    counts = defaultdict(lambda: {"count": 0, "sum": Decimal(0)})
    total = 0
    with source.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or len(reader.fieldnames) > 200:
            raise ValueError("CSV requires a header with at most 200 columns")
        group, value = parameters["group_by"], parameters["value_column"]
        if any(field and field not in reader.fieldnames for field in (group, value)):
            raise ValueError("Requested CSV column does not exist")
        for row in reader:
            total += 1
            if total > 1000000 or len(counts) > 10000:
                raise ValueError("CSV exceeds row or grouping limits")
            if None in row or None in row.values():
                raise ValueError("CSV row does not match header")
            key = row[group].strip() if group else "all"
            counts[key]["count"] += 1
            number = Decimal(row[value].strip()) if value else Decimal(0)
            if not number.is_finite() or abs(number) > Decimal("1e20"):
                raise ValueError("CSV numeric value is not finite or exceeds bounds")
            counts[key]["sum"] += number
    with (output / "aggregates.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["group", "count", "sum"])
        for key, data in sorted(counts.items()):
            # Spreadsheet formula injection protection for downloaded CSVs.
            safe_key = "'" + key if key.startswith(("=", "+", "-", "@", "\t", "\r")) else key
            writer.writerow([safe_key, data["count"], str(data["sum"])])
    return {"record_count": total, "group_count": len(counts), "numeric_column": value or None}


def images(parameters, source, output):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 16000000
    manifest = []

    def convert(data, name):
        if len(manifest) >= 100:
            raise ValueError("At most 100 images are allowed")
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 16000000:
                raise ValueError("Image exceeds 16 megapixels")
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((parameters["width"], parameters["width"]))
            target = f"thumbnail-{len(manifest) + 1:03}.png"
            image.save(output / target)
            manifest.append({"input": Path(name).name, "output": target, "width": image.width, "height": image.height})

    if source.suffix == ".zip":
        with zipfile.ZipFile(source) as archive:
            files = [i for i in archive.infolist() if not i.is_dir()]
            if len(files) > 100 or sum(i.file_size for i in files) > 50 * 1024 * 1024:
                raise ValueError("ZIP exceeds image count or expanded size limits")
            for entry in files:
                if Path(entry.filename).suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                    raise ValueError("ZIP contains an unsupported file")
                # Read bytes; never extract user paths onto the filesystem.
                convert(archive.read(entry), entry.filename)
    else:
        convert(source.read_bytes(), source.name)
    if not manifest:
        raise ValueError("No images found")
    return {"image_count": len(manifest), "images": manifest}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/config/job.json")
    parser.add_argument("--input", default="/input/input.csv")
    parser.add_argument("--output", default="/output")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    output = Path(args.output)
    started, cpu_started = time.monotonic(), time.process_time()
    print(f"Starting approved template: {config['kind']}", flush=True)
    result = {"cpu": cpu, "csv": csv_job, "images": images}[config["kind"]](config["parameters"], Path(args.input), output)
    result.update(duration_seconds=time.monotonic() - started, process_cpu_seconds=time.process_time() - cpu_started)
    (output / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
