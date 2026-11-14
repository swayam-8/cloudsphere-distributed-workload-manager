"""Kernel checks; run with Python and Pillow, or inside the job image."""
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile
from PIL import Image

spec = importlib.util.spec_from_file_location('job_kernel', Path(__file__).parents[1] / 'jobs/run.py')
kernel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kernel)


class CompressionTest(unittest.TestCase):
    def test_compression_preserves_dimensions_and_reports_actual_sizes(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / 'photo.png'
            # Deterministic varying pixels produce a meaningful compression case.
            image = Image.new('RGB', (320, 160))
            image.putdata([((i * 17) % 256, (i * 31) % 256, (i * 47) % 256) for i in range(320 * 160)])
            image.save(source, compress_level=0)
            result = kernel.images({'operation': 'compress', 'quality': 80}, source, root)
            item = result['images'][0]
            with Image.open(root / item['output']) as output:
                self.assertEqual(output.size, (320, 160))
            self.assertGreater(result['saved_bytes'], 0)
            self.assertEqual(result['saved_bytes'], source.stat().st_size - (root / item['output']).stat().st_size)

    def test_small_already_optimized_image_is_kept_when_encoding_is_larger(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / 'small.png'
            Image.new('RGBA', (4, 2), (0, 0, 0, 0)).save(source)
            result = kernel.images({'operation': 'compress', 'quality': 80}, source, root)
            self.assertTrue(result['images'][0]['kept_original'])
            self.assertEqual((root / result['images'][0]['output']).read_bytes(), source.read_bytes())
            self.assertEqual(result['saved_bytes'], 0)

    def test_zip_compresses_each_image_and_legacy_thumbnail_still_works(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / 'images.zip'
            data = io.BytesIO()
            Image.new('RGB', (800, 400), 'red').save(data, format='PNG')
            with zipfile.ZipFile(source, 'w') as archive:
                archive.writestr('one.png', data.getvalue())
                archive.writestr('two.png', data.getvalue())
            compressed = kernel.images({'operation': 'compress', 'quality': 60}, source, root)
            self.assertEqual(compressed['image_count'], 2)
            self.assertTrue(all(i['width'] == 800 and i['height'] == 400 for i in compressed['images']))
            legacy = kernel.images({'width': 64}, source, root)
            self.assertTrue(all(i['width'] == 64 and i['height'] == 32 for i in legacy['images']))


if __name__ == '__main__':
    unittest.main()
