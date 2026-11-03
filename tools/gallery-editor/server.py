#!/usr/bin/env python3
"""Local gallery manager. No third-party packages or cloud uploads."""
from datetime import datetime
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import base64
import json
import mimetypes
import os
import re
import secrets
import shutil
import struct
import tempfile
import unicodedata
import webbrowser
import sys

# Keep the native helper import tied to this tool, including isolated tests.
sys.path.insert(0, str(Path(__file__).parent))
sys.dont_write_bytecode = True
from image_processing import prepare_image, inspect_hdr

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "gallery-data.js"
PREFIX = "window.GALLERY_DATA = "
TOKEN = secrets.token_urlsafe(32)
MAX_IMAGE = 20 * 1024 * 1024
MAX_REQUEST = 128 * 1024 * 1024


def image_assets(photo):
    return {photo['src']} | ({photo['hdrSrc']} if photo.get('hdrSrc') else set())


def decoded_upload(value):
    if not isinstance(value, str) or len(value) > MAX_IMAGE * 4 // 3 + 4:
        raise ValueError('Eine vorbereitete Bilddatei darf höchstens 20 MB groß sein.')
    content = base64.b64decode(value, validate=True)
    if not 0 < len(content) <= MAX_IMAGE:
        raise ValueError('Ungültige Bildgröße.')
    width, height, extension = image_info(content)
    if not (0 < width <= 2400 and 0 < height <= 2400):
        raise ValueError('Vorbereitete Bilder dürfen maximal 2400 px groß sein.')
    return content, width, height, extension


class Conflict(ValueError):
    pass


def state():
    content = DATA.read_bytes()
    galleries = json.loads(content.decode().removeprefix(PREFIX).rstrip().removesuffix(";"))
    return {"revision": sha256(content).hexdigest(), "galleries": galleries}


def image_info(data):
    """Read dimensions from the accepted raster formats, never from user paths."""
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 33 and data[12:16] == b'IHDR':
        width, height = struct.unpack('>II', data[16:24])
        return width, height, 'png'
    if data.startswith(b'\xff\xd8') and data.endswith(b'\xff\xd9'):
        pos = 2
        while pos + 4 <= len(data):
            if data[pos] != 255:
                break
            while pos < len(data) and data[pos] == 255:
                pos += 1
            if pos >= len(data):
                break
            marker = data[pos]
            pos += 1
            length = int.from_bytes(data[pos:pos + 2], 'big')
            if length < 2 or pos + length > len(data):
                break
            if marker in (0xC0, 0xC1, 0xC2) and length >= 8:
                height, width = struct.unpack('>HH', data[pos + 3:pos + 7])
                return width, height, 'jpg'
            if marker == 0xDA:
                break
            pos += length
    if len(data) >= 30 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        kind = data[12:16]
        if kind == b'VP8X':
            return 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little'), 'webp'
        if kind == b'VP8 ' and data[23:26] == b'\x9d\x01\x2a':
            width, height = struct.unpack('<HH', data[26:30])
            return width & 0x3FFF, height & 0x3FFF, 'webp'
        if kind == b'VP8L' and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], 'little')
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, 'webp'
    raise ValueError("Bitte ein gültiges JPEG-, PNG- oder WebP-Bild verwenden.")


def photo_path(src):
    if not isinstance(src, str):
        raise ValueError("Ungültiger Bildpfad.")
    path = (ROOT / src).resolve()
    folder = (ROOT / 'media/images').resolve()
    if not path.is_relative_to(folder) or path == folder or not path.is_file():
        raise ValueError("Bilddatei fehlt oder liegt außerhalb des Medienordners.")
    return path


def gallery_label(category):
    return {'events': 'Events', 'portraits': 'Portraits'}.get(category, category)


def upload_folder(category):
    if category in ('events', 'portraits'):
        return category
    stem = unicodedata.normalize('NFKD', category).encode('ascii', 'ignore').decode()
    stem = re.sub(r'[^a-zA-Z0-9]+', '-', stem).strip('-').lower()[:50] or 'galerie'
    return stem + '-' + sha256(category.encode()).hexdigest()[:8]


def atomic_data(galleries):
    text = PREFIX + json.dumps(galleries, ensure_ascii=False, indent=2) + ";\n"
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=ROOT, prefix='.gallery-order-', delete=False) as tmp:
        tmp.write(text)
        name = tmp.name
    os.replace(name, DATA)


def save_changes(request):
    if not isinstance(request, dict):
        raise ValueError("Ungültige Anfrage.")
    current = state()
    if request.get('revision') != current['revision']:
        raise Conflict("Die Bilderliste wurde inzwischen geändert. Bitte neu laden.")
    proposed = request.get('galleries')
    if (not isinstance(proposed, dict) or not 1 <= len(proposed) <= 50
            or not set(current['galleries']).issubset(proposed)):
        raise ValueError("Bestehende Tabs müssen erhalten bleiben; maximal 50 Tabs sind möglich.")
    labels = set()
    for category in proposed:
        if (not isinstance(category, str) or not 1 <= len(category) <= 60
                or category != category.strip() or re.search(r'[/\\\x00-\x1f\x7f]', category)
                or category in ('__proto__', 'constructor', 'prototype', '.', '..')):
            raise ValueError("Bitte einen gültigen Tab-Namen mit höchstens 60 Zeichen verwenden.")
        label = gallery_label(category).casefold()
        if label in labels:
            raise ValueError("Ein Tab mit diesem Namen ist bereits vorhanden.")
        labels.add(label)
    known = {photo['src']: photo for photos in current['galleries'].values() for photo in photos}
    seen = set()
    result, uploads, removed = {}, [], []
    for category, photos in proposed.items():
        if not isinstance(photos, list) or len(photos) > 1000:
            raise ValueError("Ungültige Bilderliste.")
        result[category] = []
        for item in photos:
            if not isinstance(item, dict) or not isinstance(item.get('src'), str):
                raise ValueError("Ungültiger Bildeintrag.")
            src = item['src']
            if src in seen or type(item.get('hidden', False)) is not bool:
                raise ValueError("Doppeltes Bild oder ungültiger Sichtbarkeitswert.")
            seen.add(src)
            if src in known:
                for asset in image_assets(known[src]):
                    photo_path(asset)
                photo = dict(known[src])
                override = item.get('sdrOverride')
                if override is not None:
                    if not photo.get('hdrSrc') or not isinstance(override, dict):
                        raise ValueError('Eine eigene SDR-Version ist nur für HDR-Bilder möglich.')
                    content, width, height, extension = decoded_upload(override.get('data'))
                    if abs((width / height) / (photo['width'] / photo['height']) - 1) > 0.005:
                        raise ValueError('Die eigene SDR-Version muss denselben Bildausschnitt und dasselbe Seitenverhältnis wie das HDR-Foto haben.')
                    path = Path(src)
                    new_src = str(path.with_name(path.stem[:80] + '-sdr-' + secrets.token_hex(6) + '.' + extension))
                    uploads.append((ROOT / new_src, content))
                    hdr_content, hdr_width, hdr_height, hdr_extension = decoded_upload(override.get('hdrData'))
                    if (hdr_width, hdr_height) != (width, height) or hdr_extension != 'jpg':
                        raise ValueError('HDR- und SDR-Abmessungen müssen übereinstimmen.')
                    verified = inspect_hdr(hdr_content)
                    hdr_src = str(path.with_name(path.stem[:80] + '-hdr-' + secrets.token_hex(6) + '.jpg'))
                    uploads.append((ROOT / hdr_src, hdr_content))
                    photo.update(src=new_src, width=width, height=height, hdrSrc=hdr_src, hdrHeadroom=verified['headroom'], sdrMethod='custom-sdr')
            elif src.startswith('upload:'):
                upload = item.get('upload')
                if not isinstance(upload, dict) or not isinstance(upload.get('data'), str):
                    raise ValueError("Upload fehlt.")
                content, width, height, extension = decoded_upload(upload['data'])
                original = str(upload.get('name', 'foto'))[:200]
                stem = unicodedata.normalize('NFKD', Path(original).stem).encode('ascii', 'ignore').decode()
                stem = re.sub(r'[^a-zA-Z0-9]+', '-', stem).strip('-').lower()[:60] or 'foto'
                new_src = f'media/images/{upload_folder(category)}/{stem}-{secrets.token_hex(6)}.{extension}'
                photo = {'src': new_src, 'width': width, 'height': height,
                         'alt': str(item.get('alt', stem.replace('-', ' ')))[:200]}
                uploads.append((ROOT / new_src, content))
                if upload.get('hdrData'):
                    hdr_content, hdr_width, hdr_height, hdr_extension = decoded_upload(upload['hdrData'])
                    if (hdr_width, hdr_height) != (width, height) or hdr_extension != 'jpg':
                        raise ValueError('HDR- und SDR-Abmessungen müssen übereinstimmen.')
                    verified = inspect_hdr(hdr_content)
                    hdr_src = str(Path(new_src).with_name(Path(new_src).stem + '-hdr.jpg'))
                    uploads.append((ROOT / hdr_src, hdr_content))
                    method = upload.get('sdrMethod')
                    if method not in ('embedded-sdr', 'system-tone-map', 'custom-sdr'):
                        raise ValueError('Die SDR-Verarbeitung der HDR-Datei ist nicht angegeben.')
                    photo.update(hdrSrc=hdr_src, hdrHeadroom=verified['headroom'], sdrMethod=method)
            else:
                raise ValueError("Unbekannte Bilder können nur über die Upload-Funktion hinzugefügt werden.")
            if item.get('hidden', False):
                photo['hidden'] = True
            else:
                photo.pop('hidden', None)
            result[category].append(photo)
    previous_assets = set().union(*(image_assets(photo) for photo in known.values())) if known else set()
    final_photos = [photo for photos in result.values() for photo in photos]
    current_assets = set().union(*(image_assets(photo) for photo in final_photos)) if final_photos else set()
    for src in previous_assets - current_assets:
        removed.append(photo_path(src))
    if result == current['galleries']:
        return {**current, 'backup': None, 'uploaded': 0, 'removed': 0}
    backup = ROOT / 'Papierkorb' / ('gallery-edit-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True)
    shutil.copy2(DATA, backup / DATA.name)
    if sha256((backup / DATA.name).read_bytes()).hexdigest() != current['revision']:
        raise OSError("Sicherung konnte nicht geprüft werden.")
    # Back up every removed file before moving anything or changing the manifest.
    for path in removed:
        target = backup / 'removed' / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        if sha256(path.read_bytes()).digest() != sha256(target.read_bytes()).digest():
            raise OSError("Bildsicherung konnte nicht geprüft werden.")
    created, moved = [], []
    try:
        for path, content in uploads:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as output:
                created.append(path)
                output.write(content)
        for path in removed:
            os.replace(path, backup / 'removed' / path.relative_to(ROOT))
            moved.append(path)
        atomic_data(result)
    except OSError:
        for path in moved:
            shutil.copy2(backup / 'removed' / path.relative_to(ROOT), path)
        for path in created:
            target = backup / 'uncommitted-uploads' / path.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(path, target)
        raise
    return {**state(), 'backup': str(backup.relative_to(ROOT)), 'uploaded': sum(src.startswith('upload:') for src in seen), 'removed': len(known.keys() - seen)}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, content, content_type='application/json; charset=utf-8'):
        if not isinstance(content, bytes):
            content = content.encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.end_headers()
        self.wfile.write(content)

    def trusted(self):
        return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

    def do_GET(self):
        if not self.trusted():
            return self.reply(403, '{}')
        path = unquote(urlsplit(self.path).path)
        if path == '/api/state':
            return self.reply(200, json.dumps(state()))
        if path in ('/', '/editor'):
            html = (Path(__file__).parent / 'index.html').read_text()
            return self.reply(200, html.replace('__SAVE_TOKEN__', TOKEN), 'text/html; charset=utf-8')
        allowed = {'/styles.css', '/script.js', '/gallery-data.js',
                   '/tools/gallery-editor/editor.css', '/tools/gallery-editor/editor.js'}
        target = (ROOT / path.lstrip('/')).resolve()
        image = any(target == (ROOT / asset).resolve()
                    for photos in state()['galleries'].values() for photo in photos for asset in image_assets(photo))
        if not target.is_relative_to(ROOT) or (path not in allowed and not image) or not target.is_file():
            return self.reply(404, '{}')
        return self.reply(200, target.read_bytes(), mimetypes.guess_type(target)[0] or 'application/octet-stream')

    def do_POST(self):
        origin = f'http://127.0.0.1:{self.server.server_port}'
        if (not self.trusted() or self.path not in ('/api/save', '/api/prepare', '/api/rebase')
                or self.headers.get('Origin') != origin
                or self.headers.get('X-Gallery-Token') != TOKEN):
            return self.reply(403, json.dumps({'error': 'Speichern nur aus der lokalen Vorschau möglich.'}))
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if self.path == '/api/prepare':
                if not 0 < size <= 60 * 1024 * 1024:
                    raise ValueError('Ein Original darf höchstens 60 MB groß sein.')
                return self.reply(200, json.dumps(prepare_image(self.rfile.read(size))))
            if not 0 < size <= MAX_REQUEST:
                raise ValueError('Bitte höchstens etwa 50 MB vorbereitete Bilder auf einmal speichern.')
            request = json.loads(self.rfile.read(size))
            if self.path == '/api/rebase':
                if not isinstance(request, dict) or not isinstance(request.get('data'), str):
                    raise ValueError('Die SDR-Datei fehlt.')
                original = base64.b64decode(request['data'], validate=True)
                hdr_content, _, _, _ = decoded_upload(request.get('hdrData'))
                return self.reply(200, json.dumps(prepare_image(original, hdr_content=hdr_content)))
            self.reply(200, json.dumps(save_changes(request)))
        except Conflict as error:
            self.reply(409, json.dumps({'error': str(error)}))
        except (ValueError, TypeError, KeyError, struct.error) as error:
            self.reply(400, json.dumps({'error': str(error)}))
        except OSError:
            self.reply(500, json.dumps({'error': 'Speichern fehlgeschlagen. Bitte Schreibrechte und Speicherplatz prüfen. Vorherige Dateien sind gesichert.'}))


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 0), Handler)
    url = f'http://127.0.0.1:{server.server_port}/editor'
    print(f'Galerie-Vorschau: {url}', flush=True)
    print('Beenden mit Ctrl+C. Änderungen bleiben lokal, bis die Website veröffentlicht wird.', flush=True)
    if '--no-browser' not in __import__('sys').argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
