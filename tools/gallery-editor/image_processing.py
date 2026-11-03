"""macOS color-managed image preparation; originals never pass through canvas."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from gainmap_jpeg import browser_compatible_jpeg

SOURCE = Path(__file__).with_name('image_processor.swift')
_cache = None
_binary = None
_source_hash = None


def engine():
    global _cache, _binary, _source_hash
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if _binary is not None and _source_hash == digest:
        return _binary
    if _cache is None:
        _cache = tempfile.TemporaryDirectory(prefix='gallery-native-')
    folder = Path(_cache.name)
    binary = folder / ('processor-' + digest[:12])
    command = ['/usr/bin/swiftc', '-module-cache-path', str(folder / 'modules'), str(SOURCE), '-o', str(binary)]
    try:
        compiled = subprocess.run(command, capture_output=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError('Die native Bildverarbeitung konnte nicht gestartet werden. Den Editor bitte über die Startdatei erneut öffnen.') from error
    if compiled.returncode:
        raise ValueError('Die native HDR-Verarbeitung benötigt macOS 15+ und die installierten Apple-Entwicklerwerkzeuge.')
    _binary, _source_hash = binary, digest
    return binary


def run_engine(*args):
    try:
        result = subprocess.run([str(engine()), *map(str, args)], capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError('Die Bildverarbeitung wurde nicht abgeschlossen. Das Original bleibt unverändert.') from error
    if result.returncode:
        message = result.stderr.decode('utf-8', errors='replace').strip().splitlines()
        raise ValueError(message[-1] if message else 'Das Bild konnte nicht farbverwaltet verarbeitet werden.')
    try:
        return json.loads(result.stdout)
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError('Die Bildverarbeitung hat keine gültige Antwort geliefert.') from error


def prepare_image(content, hdr_content=None):
    if not 0 < len(content) <= 60 * 1024 * 1024:
        raise ValueError('Ein Original darf höchstens 60 MB groß sein.')
    with tempfile.TemporaryDirectory(prefix='gallery-prepare-') as name:
        folder = Path(name)
        original = folder / 'original.image'
        original.write_bytes(content)
        if hdr_content is not None:
            if not 0 < len(hdr_content) <= 20 * 1024 * 1024:
                raise ValueError('Ungültige HDR-Variante.')
            hdr_original = folder / 'hdr-original.jpg'
            hdr_original.write_bytes(hdr_content)
            info = run_engine('--rebase', hdr_original, original, folder)
        else:
            info = run_engine('--prepare', original, folder)
        sdr = (folder / ('sdr.' + info['sdrExtension'])).read_bytes()
        hdr = (folder / 'hdr.jpg').read_bytes() if info['hdr'] else None
        if hdr:
            hdr = browser_compatible_jpeg(hdr)
            (folder / 'browser-hdr.jpg').write_bytes(hdr)
            verified = run_engine('--inspect', folder / 'browser-hdr.jpg')
            if not verified['hdr']:
                raise ValueError('Die browserkompatible HDR-Ausgabe konnte nicht geprüft werden.')
        if len(sdr) > 20 * 1024 * 1024 or (hdr and len(hdr) > 20 * 1024 * 1024):
            raise ValueError('Die vorbereiteten Varianten sind zu groß (maximal 20 MB je Datei).')
        return {**info, 'data': base64.b64encode(sdr).decode(),
                'type': 'image/png' if info['sdrExtension'] == 'png' else 'image/jpeg',
                'hdrData': base64.b64encode(hdr).decode() if hdr else None}


def inspect_hdr(content):
    with tempfile.TemporaryDirectory(prefix='gallery-inspect-') as name:
        path = Path(name) / 'image.jpg'
        path.write_bytes(content)
        result = run_engine('--inspect', path)
        if not result['hdr']:
            raise ValueError('Die hochgeladene HDR-Variante enthält keine verifizierbaren HDR-Bilddaten.')
        return result
