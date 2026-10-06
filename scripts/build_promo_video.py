"""Build the short ParcelLA product tour from the checked-in product screens."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
OUTPUT = ASSETS / "parcella-tour.mp4"


def ffmpeg_executable() -> str:
    configured = os.environ.get("PARCELLA_FFMPEG")
    if configured:
        return configured
    installed = shutil.which("ffmpeg")
    if installed:
        return installed
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise SystemExit(
            "Install imageio-ffmpeg or set PARCELLA_FFMPEG to an ffmpeg executable."
        ) from exc


def text_filter(text: str, size: int, x: int, y: int, color: str = "white") -> str:
    font = "C\\:/Windows/Fonts/arialbd.ttf"
    return (
        f"drawtext=fontfile='{font}':text='{text}':fontcolor={color}:"
        f"fontsize={size}:x={x}:y={y}"
    )


def main() -> None:
    dashboard = ASSETS / "parcella-dashboard.png"
    records = ASSETS / "parcella-records.png"
    exports = ASSETS / "parcella-exports.png"
    for source in (dashboard, records, exports):
        if not source.exists():
            raise SystemExit(f"Missing source image: {source}")

    gold = "0xE1B756"
    filters = [
        (
            "[0:v]scale=-1:1080,crop=1920:1080:x='(in_w-out_w)*0.52':y=0,"
            "drawbox=x=0:y=0:w=iw:h=ih:color=0x07162D@0.74:t=fill,"
            f"{text_filter('PARCELLA', 88, 120, 305)},"
            f"{text_filter('Every listing. Every filing. Underwritten.', 48, 120, 425, gold)},"
            f"{text_filter('Los Angeles development intelligence', 27, 124, 505, 'white@0.78')},"
            "format=yuv420p[v0]"
        ),
        (
            "[1:v]scale=-1:1080,crop=1920:1080:"
            "x='(in_w-out_w)*min(n/180,1)':y=0,"
            "drawbox=x=0:y=785:w=iw:h=295:color=0x07162D@0.88:t=fill,"
            f"{text_filter('DISCOVER + UNDERWRITE', 28, 100, 832, gold)},"
            f"{text_filter('Screen the entire development pipeline.', 48, 100, 882)},"
            f"{text_filter('Filter opportunities. Compare returns. Change assumptions live.', 26, 102, 956, 'white@0.82')},"
            "format=yuv420p[v1]"
        ),
        (
            "[2:v]scale=1920:1080,"
            "drawbox=x=0:y=0:w=700:h=1080:color=0x07162D@0.88:t=fill,"
            f"{text_filter('VERIFY', 30, 92, 255, gold)},"
            f"{text_filter('Know the property', 50, 92, 325)},"
            f"{text_filter('behind the deal.', 50, 92, 390)},"
            f"{text_filter('Ownership  |  APNs  |  Sales', 25, 96, 505, 'white@0.82')},"
            f"{text_filter('Debt  |  Plans  |  Determinations', 25, 96, 550, 'white@0.82')},"
            "format=yuv420p[v2]"
        ),
        (
            "[3:v]scale=1920:1080,"
            "drawbox=x=0:y=0:w=iw:h=155:color=0x07162D@0.93:t=fill,"
            f"{text_filter('DELIVER THE DECISION', 29, 95, 42, gold)},"
            f"{text_filter('One live model. Excel + PDF.', 44, 650, 35)},"
            "format=yuv420p[v3]"
        ),
        (
            "[4:v]scale=-1:1080,crop=1920:1080:x='(in_w-out_w)*0.5':y=0,"
            "drawbox=x=0:y=0:w=iw:h=ih:color=0x07162D@0.80:t=fill,"
            f"{text_filter('PARCELLA', 82, 120, 330)},"
            f"{text_filter('Stop browsing. Start underwriting.', 48, 120, 445, gold)},"
            f"{text_filter('parcel-la.vercel.app', 29, 124, 535, 'white@0.82')},"
            "format=yuv420p[v4]"
        ),
        "[v0][v1]xfade=transition=fade:duration=0.6:offset=3.4[x1]",
        "[x1][v2]xfade=transition=fade:duration=0.6:offset=9.8[x2]",
        "[x2][v3]xfade=transition=fade:duration=0.6:offset=15.2[x3]",
        "[x3][v4]xfade=transition=fade:duration=0.6:offset=20.0[outv]",
    ]
    command = [
        ffmpeg_executable(),
        "-y",
        "-loop", "1", "-t", "4", "-i", str(dashboard),
        "-loop", "1", "-t", "7", "-i", str(dashboard),
        "-loop", "1", "-t", "6", "-i", str(records),
        "-loop", "1", "-t", "6", "-i", str(exports),
        "-loop", "1", "-t", "4", "-i", str(dashboard),
        "-filter_complex", ";".join(filters),
        "-map", "[outv]",
        "-r", "30",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(OUTPUT),
    ]
    subprocess.run(command, check=True)
    print(f"Created {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
