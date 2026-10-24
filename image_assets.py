"""Store validated, metadata-free local reading images under immutable names."""
import base64
import binascii
import hashlib
from io import BytesIO
from pathlib import Path
import re
import shutil
import warnings

NAME = re.compile(r'[a-f0-9]{64}\.(?:png|jpg|webp)\Z')
MAX_BYTES = 5 * 1024 * 1024


def asset_path(content, name):
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ValueError('图片路径无效。')
    directory = content / 'images'
    path = directory / name
    if directory.is_symlink() or path.is_symlink():
        raise ValueError('图片路径无效。')
    return path


def upload(content, body):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 20_000_000
    encoded = body.get('data')
    if not isinstance(encoded, str) or len(encoded) > (MAX_BYTES + 2) // 3 * 4:
        raise ValueError('图片过大，请使用 5 MB 以内的 PNG、JPEG 或 WebP 图片。')
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > MAX_BYTES:
            raise ValueError('Invalid image size')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > Image.MAX_IMAGE_PIXELS:
                    raise ValueError('Unsupported image')
                image.load()
                image = ImageOps.exif_transpose(image)
                image.thumbnail((2400, 2400))
                transparent = 'A' in image.getbands() or 'transparency' in image.info
                image = image.convert('RGBA' if transparent else 'RGB')
                image.info.clear()
                output = BytesIO()
                extension = 'png' if transparent else 'jpg'
                image.save(output, format='PNG' if transparent else 'JPEG', quality=90)
    except (ValueError, OSError, SyntaxError, binascii.Error, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise ValueError('无法读取图片，请使用 5 MB 以内的有效 PNG、JPEG 或 WebP 文件。') from None
    payload = output.getvalue()
    name = hashlib.sha256(payload).hexdigest() + '.' + extension
    path = asset_path(content, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(payload)
    return {'path': '../images/' + name, 'url': 'media/' + name}


def export_images(content, output):
    directory = content / 'images'
    if not directory.exists():
        return
    if directory.is_symlink():
        raise ValueError('图片目录无效。')
    for path in directory.iterdir():
        if not NAME.fullmatch(path.name):
            continue
        source = asset_path(content, path.name)
        if not source.is_file():
            raise ValueError('图片资源不存在。')
        target = output / 'media' / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
