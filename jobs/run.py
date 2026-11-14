"""Fixed, bounded job templates. No input is ever evaluated as code or a command."""
import argparse
import io
import json
import math
import time
import zipfile
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
    from analytics import analyze
    return analyze(parameters, source, output)


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
            original_format = image.format
            image = ImageOps.exif_transpose(image)
            operation = parameters.get("operation", "thumbnail")
            if operation == "compress":
                # JPEG has no alpha channel: composite transparent inputs on white.
                rgba = image.convert("RGBA")
                image = Image.new("RGB", rgba.size, "white")
                image.paste(rgba, mask=rgba.getchannel("A"))
                encoded = io.BytesIO()
                image.save(encoded, format="JPEG", quality=parameters.get("quality", 80), optimize=True)
                payload = encoded.getvalue()
                kept_original = len(payload) >= len(data)
                if kept_original:
                    payload = data
                extension = ("png" if original_format == "PNG" else "jpg") if kept_original else "jpg"
                target = f"compressed-{len(manifest) + 1:03}.{extension}"
                (output / target).write_bytes(payload)
            else:
                image = image.convert("RGB")
                image.thumbnail((parameters["width"], parameters["width"]))
                target = f"thumbnail-{len(manifest) + 1:03}.png"
                image.save(output / target)
                payload = (output / target).read_bytes()
                kept_original = False
            manifest.append({"input": Path(name).name, "output": target, "width": image.width, "height": image.height,
                             "input_bytes": len(data), "output_bytes": len(payload),
                             "saved_bytes": len(data) - len(payload), "kept_original": kept_original})

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
    input_bytes = sum(item["input_bytes"] for item in manifest)
    output_bytes = sum(item["output_bytes"] for item in manifest)
    return {"image_count": len(manifest), "images": manifest, "operation": parameters.get("operation", "thumbnail"),
            "input_bytes": input_bytes, "output_bytes": output_bytes,
            "saved_bytes": input_bytes - output_bytes,
            "saved_percent": round(100 * (input_bytes - output_bytes) / input_bytes, 1)}


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
    result["task_id"] = config.get("task_id")
    (output / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
