import os
import sys
from PIL import Image
from PIL.ImageOps import exif_transpose
from pillow_heif import register_heif_opener

register_heif_opener()


def main():
    if len(sys.argv) < 3:
        sys.exit(1)
    src_path = sys.argv[1]
    dst_path = sys.argv[2]
    thumb_size = int(sys.argv[3]) if len(sys.argv) > 3 else 0

    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    img = exif_transpose(Image.open(src_path)).convert("RGB")
    if thumb_size > 0:
        w, h = img.size
        s = min(w, h)
        left = (w - s) // 2
        top = (h - s) // 2
        img = img.crop((left, top, left + s, top + s)).resize(
            (thumb_size, thumb_size), Image.Resampling.LANCZOS
        )
        img.save(dst_path, "JPEG", quality=90)
    else:
        img.save(dst_path, "JPEG", quality=95)


if __name__ == "__main__":
    main()
