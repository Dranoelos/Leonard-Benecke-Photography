"""Package Core Image's gain map as browser-compatible Adobe Ultra HDR JPEG.

No pixels are decoded or recompressed: both JPEG codestreams and ICC profiles
are preserved. Only the container/XMP/MPF metadata are rewritten.
Specification references: Adobe Gain Map 1.0; Google's libultrahdr JPEG/R writer.
"""
import math
import re
import struct
import xml.etree.ElementTree as ET

XMP = b'http://ns.adobe.com/xap/1.0/\x00'
GAIN = 'http://ns.adobe.com/hdr-gain-map/1.0/'
RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'


def jpeg_end(data, start=0):
    if data[start:start + 2] != b'\xff\xd8':
        raise ValueError('Ungültiger JPEG-Container.')
    pos = start + 2
    while pos < len(data):
        if data[pos] != 255:
            raise ValueError('Ungültige JPEG-Markierung.')
        while pos < len(data) and data[pos] == 255:
            pos += 1
        if pos >= len(data):
            break
        marker = data[pos]
        pos += 1
        if marker == 0xD9:
            return pos
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if pos + 2 > len(data):
            break
        length = int.from_bytes(data[pos:pos + 2], 'big')
        if length < 2 or pos + length > len(data):
            break
        pos += length
        if marker == 0xDA:
            while pos < len(data):
                pos = data.find(b'\xff', pos)
                if pos < 0 or pos + 1 >= len(data):
                    raise ValueError('Unvollständige JPEG-Bilddaten.')
                following = data[pos + 1]
                if following == 0 or 0xD0 <= following <= 0xD7:
                    pos += 2
                elif following == 255:
                    pos += 1
                else:
                    break
    raise ValueError('Unvollständige JPEG-Datei.')


def split_images(data):
    first_end = jpeg_end(data)
    second_start = data.find(b'\xff\xd8', first_end)
    if second_start < 0:
        raise ValueError('Die HDR-Gain-Map fehlt im JPEG-Container.')
    second_end = jpeg_end(data, second_start)
    if data[second_end:].strip(b'\x00\xff'):
        raise ValueError('Unerwartete weitere JPEG-Bilddaten.')
    return data[:first_end], data[second_start:second_end]


def clean_jpeg(data):
    """Remove old XMP and MPF, retaining ICC, EXIF, and every encoded pixel byte."""
    output = bytearray(b'\xff\xd8')
    pos = 2
    while pos + 4 <= len(data):
        start = pos
        if data[pos] != 255:
            raise ValueError('Ungültiger JPEG-Header.')
        while data[pos] == 255:
            pos += 1
        marker = data[pos]
        pos += 1
        if marker in (0xDA, 0xD9):
            output.extend(data[start:])
            return bytes(output)
        length = int.from_bytes(data[pos:pos + 2], 'big')
        if length < 2 or pos + length > len(data):
            raise ValueError('Ungültiger JPEG-Header.')
        payload = data[pos + 2:pos + length]
        if not (marker == 0xE1 and payload.startswith(XMP) or marker == 0xE2 and payload.startswith(b'MPF\x00')):
            output.extend(data[start:pos + length])
        pos += length
    raise ValueError('Unvollständiger JPEG-Header.')


def segment(marker, payload):
    if len(payload) > 65533:
        raise ValueError('JPEG-Metadaten sind zu groß.')
    return bytes((255, marker)) + struct.pack('>H', len(payload) + 2) + payload


def xml_packet(description):
    return (f'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="{RDF}">{description}</rdf:RDF></x:xmpmeta>').encode()


def apple_metadata(data):
    for packet in re.findall(rb'<x:xmpmeta\b.*?</x:xmpmeta>', data, re.S):
        root = ET.fromstring(packet)
        channels = root.find(f'.//{{{GAIN}}}ChannelMetadata/{{{RDF}}}Seq')
        if channels is None:
            continue
        values = {}
        for name in ['GainMapMin', 'GainMapMax', 'Gamma', 'OffsetSDR', 'OffsetHDR']:
            items = [float(item.find(f'{{{GAIN}}}{name}').text) for item in channels]
            if len(items) not in (1, 3) or not all(math.isfinite(value) for value in items):
                raise ValueError('Ungültige Gain-Map-Kanalmetadaten.')
            values[name] = items
        for old, new in [('BaseHeadroom', 'HDRCapacityMin'), ('AlternateHeadroom', 'HDRCapacityMax')]:
            item = root.find(f'.//{{{GAIN}}}{old}')
            if item is None or not math.isfinite(float(item.text)):
                raise ValueError('Die HDR-Helligkeitsmetadaten fehlen.')
            values[new] = float(item.text)
        base = root.find(f'.//{{{GAIN}}}BaseRenditionIsHDR')
        if base is not None and base.text not in ('0', 'False', 'false'):
            raise ValueError('Eine HDR-Basis wird für diesen Export nicht unterstützt.')
        return values
    return None


def browser_compatible_jpeg(data):
    values = apple_metadata(data)
    if values is None:
        return data
    base, gainmap = map(clean_jpeg, split_images(data))
    attrs = [f'xmlns:hdrgm="{GAIN}"', 'hdrgm:Version="1.0"', 'hdrgm:BaseRenditionIsHDR="False"']
    elements = []
    for name, value in values.items():
        if isinstance(value, list):
            if all(abs(item - value[0]) < 1e-9 for item in value):
                attrs.append(f'hdrgm:{name}="{value[0]:.9g}"')
            else:
                items = ''.join(f'<rdf:li>{item:.9g}</rdf:li>' for item in value)
                elements.append(f'<hdrgm:{name}><rdf:Seq>{items}</rdf:Seq></hdrgm:{name}>')
        else:
            attrs.append(f'hdrgm:{name}="{value:.9g}"')
    secondary_xml = xml_packet('<rdf:Description ' + ' '.join(attrs) + '>' + ''.join(elements) + '</rdf:Description>')
    secondary = gainmap[:2] + segment(0xE1, XMP + secondary_xml) + gainmap[2:]
    primary_xml = xml_packet(
        f'<rdf:Description xmlns:hdrgm="{GAIN}" hdrgm:Version="1.0" '
        'xmlns:Container="http://ns.google.com/photos/1.0/container/" '
        'xmlns:Item="http://ns.google.com/photos/1.0/container/item/">'
        '<Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource">'
        '<Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/>'
        '</rdf:li><rdf:li rdf:parseType="Resource">'
        f'<Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="{len(secondary)}"/>'
        '</rdf:li></rdf:Seq></Container:Directory></rdf:Description>')
    primary_xmp = segment(0xE1, XMP + primary_xml)
    # MPF is inserted directly after SOI; its TIFF header starts at file offset 10.
    mpf_size = 90
    primary_size = len(base) + len(primary_xmp) + mpf_size
    tiff = b'MM\x00*' + struct.pack('>IH', 8, 3)
    tiff += struct.pack('>HHI4s', 0xB000, 7, 4, b'0100')
    tiff += struct.pack('>HHII', 0xB001, 4, 1, 2)
    tiff += struct.pack('>HHII', 0xB002, 7, 32, 50)
    tiff += struct.pack('>I', 0)
    tiff += struct.pack('>IIIHH', 0x00030000, primary_size, 0, 0, 0)
    tiff += struct.pack('>IIIHH', 0, len(secondary), primary_size - 10, 0, 0)
    mpf = segment(0xE2, b'MPF\x00' + tiff)
    if len(mpf) != mpf_size:
        raise ValueError('Ungültiger MPF-Index.')
    result = base[:2] + mpf + primary_xmp + base[2:] + secondary
    if tuple(map(clean_jpeg, split_images(result))) != (base, gainmap):
        raise ValueError('Der HDR-Container hat die kodierten Bilddaten verändert.')
    return result
