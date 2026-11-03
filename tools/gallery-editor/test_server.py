"""File-safety tests run against isolated temporary galleries, never real photos."""
import base64
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('gallery_server', Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def png(width=2, height=3):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress((b'\x00' + b'\x00\x00\x00' * width) * height)) + chunk(b'IEND', b''))


def jpeg_header(width=2, height=3):
    return b'\xff\xd8\xff\xc2\x00\x0b\x08' + struct.pack('>HH', height, width) + b'\x01\x01\x11\x00\xff\xd9'


class GalleryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        server.ROOT = Path(self.temp.name).resolve()
        server.DATA = server.ROOT / 'gallery-data.js'
        self.data = {'events': [], 'portraits': []}
        for category, count in [('events', 2), ('portraits', 1)]:
            for index in range(count):
                src = f'media/images/{category}/{index}.png'
                path = server.ROOT / src
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(png())
                self.data[category].append({'src': src, 'width': 2, 'height': 3, 'alt': 'Test'})
        server.atomic_data(self.data)
        self.original = server.DATA.read_bytes()

    def tearDown(self):
        self.temp.cleanup()

    def request(self):
        return {'revision': server.state()['revision'], 'galleries': json.loads(json.dumps(self.data))}

    def upload(self):
        return {'src': 'upload:test', 'alt': 'Neues Bild', 'upload': {'name': '../../test.jpg', 'data': base64.b64encode(png()).decode()}}

    def test_reorder_hide_preserve_original_and_backup(self):
        request = self.request()
        request['galleries']['events'].reverse()
        request['galleries']['events'][0]['hidden'] = True
        result = server.save_changes(request)
        self.assertTrue(result['galleries']['events'][0]['hidden'])
        self.assertEqual(result['galleries']['events'][0]['src'], self.data['events'][1]['src'])
        self.assertEqual((server.ROOT / result['backup'] / 'gallery-data.js').read_bytes(), self.original)
        self.assertTrue(all((server.ROOT / photo['src']).is_file() for photo in self.data['events']))
        request = {'revision': result['revision'], 'galleries': result['galleries']}
        request['galleries']['events'][0]['hidden'] = False
        self.assertNotIn('hidden', server.save_changes(request)['galleries']['events'][0])

    def test_remove_moves_exact_file_to_trash(self):
        request = self.request()
        removed = request['galleries']['events'].pop(0)
        result = server.save_changes(request)
        self.assertFalse((server.ROOT / removed['src']).exists())
        self.assertEqual((server.ROOT / result['backup'] / 'removed' / removed['src']).read_bytes(), png())
        self.assertTrue((server.ROOT / self.data['events'][1]['src']).exists())
        self.assertEqual(result['removed'], 1)

    def test_upload_no_overwrite_and_server_dimensions(self):
        request = self.request()
        item = self.upload()
        item.update(width=999, height=999)
        request['galleries']['events'].append(item)
        result = server.save_changes(request)
        added = result['galleries']['events'][-1]
        self.assertTrue(added['src'].startswith('media/images/events/test-'))
        self.assertTrue(added['src'].endswith('.png'))
        self.assertEqual((added['width'], added['height']), (2, 3))
        self.assertEqual((server.ROOT / added['src']).read_bytes(), png())
        self.assertEqual(result['uploaded'], 1)

    def test_stale_revision_cannot_delete(self):
        request = self.request()
        request['revision'] = 'stale'
        request['galleries']['events'] = []
        with self.assertRaises(server.Conflict):
            server.save_changes(request)
        self.assertEqual(server.DATA.read_bytes(), self.original)
        self.assertTrue((server.ROOT / self.data['events'][0]['src']).exists())

    def test_invalid_upload_does_not_apply_other_removals(self):
        request = self.request()
        request['galleries']['events'] = [self.upload()]
        request['galleries']['events'][0]['upload']['data'] = base64.b64encode(b'<svg>bad</svg>').decode()
        with self.assertRaises(ValueError):
            server.save_changes(request)
        self.assertEqual(server.DATA.read_bytes(), self.original)
        self.assertTrue((server.ROOT / self.data['events'][0]['src']).exists())

    def test_unknown_or_duplicate_paths_rejected(self):
        for bad in ['../../index.html', self.data['portraits'][0]['src'], self.data['events'][0]['src']]:
            with self.subTest(path=bad):
                request = self.request()
                request['galleries']['events'].append({'src': bad})
                with self.assertRaises(ValueError):
                    server.save_changes(request)
                self.assertEqual(server.DATA.read_bytes(), self.original)

    def test_failed_manifest_write_restores_removed_files(self):
        request = self.request()
        removed = request['galleries']['events'].pop(0)
        request['galleries']['events'].append(self.upload())
        with patch.object(server, 'atomic_data', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                server.save_changes(request)
        self.assertEqual(server.DATA.read_bytes(), self.original)
        self.assertEqual((server.ROOT / removed['src']).read_bytes(), png())
        self.assertEqual(len(list((server.ROOT / 'media/images/events').iterdir())), 2)
        self.assertTrue(list((server.ROOT / 'Papierkorb').rglob('uncommitted-uploads')))

    def test_empty_gallery_can_accept_upload(self):
        request = self.request()
        request['galleries']['events'] = []
        result = server.save_changes(request)
        request = {'revision': result['revision'], 'galleries': result['galleries']}
        request['galleries']['events'].append(self.upload())
        self.assertEqual(len(server.save_changes(request)['galleries']['events']), 1)

    def test_jpeg_and_webp_dimensions(self):
        # A JPEG dimensions header with an APP segment before the progressive frame.
        jpeg = b'\xff\xd8\xff\xe0\x00\x04AB\xff\xc2\x00\x0b\x08' + struct.pack('>HH', 300, 400) + b'\x01\x01\x11\x00\xff\xd9'
        self.assertEqual(server.image_info(jpeg), (400, 300, 'jpg'))
        # Extended, lossless, and lossy WebP frame headers.
        extended = b'RIFF' + b'\0' * 4 + b'WEBPVP8X' + b'\0' * 8 + (399).to_bytes(3, 'little') + (299).to_bytes(3, 'little')
        self.assertEqual(server.image_info(extended), (400, 300, 'webp'))
        bits = 399 | (299 << 14)
        lossless = b'RIFF' + b'\0' * 4 + b'WEBPVP8L' + b'\0' * 4 + b'\x2f' + bits.to_bytes(4, 'little') + b'\0' * 5
        self.assertEqual(server.image_info(lossless), (400, 300, 'webp'))
        lossy = b'RIFF' + b'\0' * 4 + b'WEBPVP8 ' + b'\0' * 7 + b'\x9d\x01\x2a' + struct.pack('<HH', 400, 300)
        self.assertEqual(server.image_info(lossy), (400, 300, 'webp'))

    def test_unchanged_save_creates_no_backup(self):
        result = server.save_changes(self.request())
        self.assertIsNone(result['backup'])
        self.assertFalse((server.ROOT / 'Papierkorb').exists())

    def test_move_between_galleries_preserves_file_and_hidden_state(self):
        request = self.request()
        photo = request['galleries']['events'].pop(0)
        photo['hidden'] = True
        request['galleries']['portraits'].append(photo)
        result = server.save_changes(request)
        self.assertEqual(result['galleries']['portraits'][-1], photo)
        self.assertEqual(len(result['galleries']['events']), 1)
        self.assertEqual(result['removed'], 0)
        self.assertEqual(result['uploaded'], 0)
        self.assertEqual((server.ROOT / photo['src']).read_bytes(), png())
        self.assertFalse((server.ROOT / result['backup'] / 'removed').exists())

    def test_custom_tab_persists_and_accepts_upload_and_existing_photo(self):
        request = self.request()
        request['galleries']['Hochzeiten & Feste'] = []
        created = server.save_changes(request)
        self.assertEqual(server.state()['galleries']['Hochzeiten & Feste'], [])
        request = {'revision': created['revision'], 'galleries': created['galleries']}
        photo = request['galleries']['events'].pop(0)
        request['galleries']['Hochzeiten & Feste'] = [photo, self.upload()]
        saved = server.save_changes(request)
        self.assertEqual(saved['removed'], 0)
        self.assertEqual(saved['uploaded'], 1)
        added = saved['galleries']['Hochzeiten & Feste'][1]
        self.assertTrue(added['src'].startswith('media/images/hochzeiten-feste-'))
        self.assertEqual((server.ROOT / added['src']).read_bytes(), png())
        self.assertTrue((server.ROOT / photo['src']).is_file())

    def test_invalid_or_duplicate_tab_names_cannot_change_files(self):
        for name in ['../outside', 'bad\\name', '__proto__', 'constructor', '.', ' events ', 'Events', 'PORTRAITS', 'x' * 61, 'bad\nname']:
            with self.subTest(name=name):
                request = self.request()
                request['galleries'][name] = [self.upload()]
                with self.assertRaises(ValueError):
                    server.save_changes(request)
                self.assertEqual(server.DATA.read_bytes(), self.original)

    def test_existing_tabs_cannot_be_deleted_accidentally(self):
        request = self.request()
        request['galleries'].pop('portraits')
        with self.assertRaises(ValueError):
            server.save_changes(request)
        self.assertEqual(server.DATA.read_bytes(), self.original)

    def test_failed_write_after_transfer_does_not_remove_transferred_photo(self):
        request = self.request()
        photo = request['galleries']['events'].pop(0)
        request['galleries']['portraits'].append(photo)
        with patch.object(server, 'atomic_data', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                server.save_changes(request)
        self.assertEqual(server.DATA.read_bytes(), self.original)
        self.assertEqual((server.ROOT / photo['src']).read_bytes(), png())

    def make_hdr(self):
        photo = self.data['events'][0]
        hdr_src = 'media/images/events/0-hdr.jpg'
        (server.ROOT / hdr_src).write_bytes(jpeg_header())
        photo.update(hdrSrc=hdr_src, hdrHeadroom=4, sdrMethod='embedded-sdr')
        server.atomic_data(self.data)
        self.original = server.DATA.read_bytes()
        return photo

    @patch.object(server, 'inspect_hdr', return_value={'headroom': 4})
    def test_hdr_upload_and_deletion_handle_both_files(self, inspect):
        request = self.request()
        item = self.upload()
        item['upload'].update(hdrData=base64.b64encode(jpeg_header()).decode(), sdrMethod='embedded-sdr')
        request['galleries']['events'].append(item)
        result = server.save_changes(request)
        added = result['galleries']['events'][-1]
        self.assertEqual(added['hdrHeadroom'], 4)
        self.assertTrue((server.ROOT / added['src']).exists())
        self.assertTrue((server.ROOT / added['hdrSrc']).exists())
        result['galleries']['events'].pop()
        removed = server.save_changes({'revision': result['revision'], 'galleries': result['galleries']})
        for asset in server.image_assets(added):
            self.assertFalse((server.ROOT / asset).exists())
            self.assertTrue((server.ROOT / removed['backup'] / 'removed' / asset).exists())
        self.assertEqual(removed['removed'], 1)

    def test_hdr_transfer_preserves_both_files(self):
        photo = self.make_hdr()
        request = self.request()
        request['galleries']['portraits'].append(request['galleries']['events'].pop(0))
        result = server.save_changes(request)
        self.assertEqual(result['removed'], 0)
        for asset in server.image_assets(photo):
            self.assertTrue((server.ROOT / asset).exists())

    @patch.object(server, 'inspect_hdr', return_value={'headroom': 4})
    def test_custom_sdr_replacement_archives_old_pair(self, inspect):
        old = dict(self.make_hdr())
        request = self.request()
        request['galleries']['events'][0]['sdrOverride'] = {
            'data': base64.b64encode(png()).decode(), 'hdrData': base64.b64encode(jpeg_header()).decode()}
        result = server.save_changes(request)
        new = result['galleries']['events'][0]
        self.assertEqual(new['sdrMethod'], 'custom-sdr')
        self.assertEqual(result['removed'], 0)
        for asset in server.image_assets(old):
            self.assertFalse((server.ROOT / asset).exists())
            self.assertTrue((server.ROOT / result['backup'] / 'removed' / asset).exists())
        for asset in server.image_assets(new):
            self.assertTrue((server.ROOT / asset).exists())

    def test_invalid_hdr_does_not_silently_save_as_sdr(self):
        request = self.request()
        item = self.upload()
        item['upload'].update(hdrData=base64.b64encode(jpeg_header()).decode(), sdrMethod='embedded-sdr')
        request['galleries']['events'].append(item)
        with patch.object(server, 'inspect_hdr', side_effect=ValueError('No HDR')):
            with self.assertRaises(ValueError):
                server.save_changes(request)
        self.assertEqual(server.DATA.read_bytes(), self.original)


if __name__ == '__main__':
    unittest.main()
