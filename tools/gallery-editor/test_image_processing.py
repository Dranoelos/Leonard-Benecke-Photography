"""Native integration tests using generated color/HDR references, no user photos."""
import base64
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from image_processing import prepare_image, inspect_hdr, run_engine
from gainmap_jpeg import browser_compatible_jpeg, clean_jpeg, split_images


class NativeImageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='gallery-hdr-tests-')
        cls.folder = Path(cls.temp.name)
        run_engine('--fixtures', cls.folder)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def input(self, name):
        return (self.folder / name).read_bytes()

    def prepared_file(self, result, field='data', suffix='.jpg'):
        path = self.folder / (self._testMethodName + '-' + field + suffix)
        path.write_bytes(base64.b64decode(result[field]))
        return path

    def test_gainmap_hdr_and_authored_sdr_survive(self):
        result = prepare_image(self.input('gainmap.jpg'))
        self.assertTrue(result['hdr'])
        browser_hdr = base64.b64decode(result['hdrData'])
        self.assertIn(b'hdrgm:Version="1.0"', browser_hdr)
        self.assertIn(b'hdrgm:HDRCapacityMax=', browser_hdr)
        self.assertEqual(browser_compatible_jpeg(browser_hdr), browser_hdr)
        self.assertEqual(result['sdrMethod'], 'embedded-sdr')
        verified = inspect_hdr(base64.b64decode(result['hdrData']))
        self.assertGreaterEqual(verified['headroom'], 3.9)
        self.assertGreater(verified['peakLinear'], 2.0)
        difference = run_engine('--compare', self.folder / 'reference-sdr.jpg', self.prepared_file(result))
        self.assertLess(difference['meanError'], 3.0, difference)
        # Browsers without HDR decoding see the same authored SDR in the gain-map JPEG.
        pair_difference = run_engine('--compare', self.prepared_file(result), self.prepared_file(result, 'hdrData'))
        self.assertLess(pair_difference['meanError'], 3.0, pair_difference)

    def test_browser_container_preserves_encoded_pixels(self):
        source = self.input('gainmap.jpg')
        adapted = browser_compatible_jpeg(source)
        self.assertEqual(tuple(map(clean_jpeg, split_images(source))),
                         tuple(map(clean_jpeg, split_images(adapted))))
        before, after = self.folder / 'gainmap.jpg', self.folder / 'browser.jpg'
        after.write_bytes(adapted)
        difference = run_engine('--compare', before, after)
        self.assertEqual(difference['maxError'], 0)

    def test_iso_hdr_has_explicit_sdr_tonemap_and_hdr_output(self):
        result = prepare_image(self.input('iso-hdr.heic'))
        self.assertTrue(result['hdr'])
        self.assertEqual(result['sdrMethod'], 'system-tone-map')
        self.assertGreater(inspect_hdr(base64.b64decode(result['hdrData']))['headroom'], 1.5)
        sdr = run_engine('--inspect', self.prepared_file(result))
        self.assertFalse(sdr['hdr'])
        self.assertIn('sRGB', sdr['profile'])

    def test_display_p3_sdr_is_not_misclassified_as_hdr(self):
        result = prepare_image(self.input('p3-sdr.png'))
        self.assertFalse(result['hdr'])
        self.assertIsNone(result['hdrData'])
        self.assertEqual(result['sdrMethod'], 'color-managed-sdr')
        difference = run_engine('--compare', self.folder / 'sdr.png', self.prepared_file(result))
        self.assertLess(difference['meanError'], 3.0, difference)

    def test_sdr_stays_sdr_and_is_resized_without_upscaling(self):
        small = prepare_image(self.input('sdr.png'))
        self.assertEqual((small['width'], small['height']), (256, 64))
        self.assertFalse(small['hdr'])
        large = prepare_image(self.input('large-sdr.png'))
        self.assertEqual((large['width'], large['height']), (2400, 600))

    def test_exif_orientation_is_baked_into_output(self):
        result = prepare_image(self.input('orientation.jpg'))
        self.assertEqual((result['width'], result['height']), (64, 256))

    def test_custom_sdr_recomputes_hdr_gainmap_with_same_sdr_base(self):
        result = prepare_image(self.input('reference-sdr.jpg'), hdr_content=self.input('gainmap.jpg'))
        self.assertEqual(result['sdrMethod'], 'custom-sdr')
        self.assertGreater(inspect_hdr(base64.b64decode(result['hdrData']))['headroom'], 3.9)
        difference = run_engine('--compare', self.folder / 'reference-sdr.jpg', self.prepared_file(result))
        self.assertLess(difference['meanError'], 3.0, difference)
        pair_difference = run_engine('--compare', self.prepared_file(result), self.prepared_file(result, 'hdrData'))
        self.assertLess(pair_difference['meanError'], 3.0, pair_difference)

    def test_hdr_file_cannot_be_mistaken_for_custom_sdr(self):
        with self.assertRaises(ValueError):
            prepare_image(self.input('gainmap.jpg'), hdr_content=self.input('gainmap.jpg'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
