"""Build the narrated ParcelLA product tour from checked-in product screens."""

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
    feasibility = ASSETS / "parcella-feasibility.png"
    settings = ASSETS / "parcella-settings.png"
    records = ASSETS / "parcella-records.png"
    exports = ASSETS / "parcella-exports.png"
    voice = ASSETS / "parcella-tour-voice.mp3"
    for source in (dashboard, feasibility, settings, records, exports, voice):
        if not source.exists():
            raise SystemExit(f"Missing source image: {source}")

    gold = "0xE1B756"
    filters = [
        (
            "[0:v]scale=-1:1080,crop=1920:1080:x='(in_w-out_w)*0.52':y=0,"
            "drawbox=x=0:y=0:w=iw:h=ih:color=0x07162D@0.76:t=fill,"
            f"{text_filter('PARCELLA', 84, 110, 320)},"
            f"{text_filter('Turn any address into an underwritten opportunity.', 44, 112, 430, gold)},"
            f"{text_filter('Zoning. Incentives. Records. Returns.', 26, 116, 505, 'white@0.82')},"
            "format=yuv420p[v0]"
        ),
        (
            "[1:v]scale=1920:1080,"
            "drawbox=x=1050:y=86:w=790:h=86:color=0x07162D@0.92:t=fill,"
            f"{text_filter('1  ANALYZE ANY ADDRESS', 31, 1080, 110)},"
            f"{text_filter('Compare by-right + incentive pathways', 21, 1082, 150, gold)},"
            "format=yuv420p[v1]"
        ),
        (
            "[2:v]scale=-1:1080,crop=1920:1080:x='(in_w-out_w)*0.10':y=0,"
            "drawbox=x=0:y=800:w=iw:h=280:color=0x07162D@0.91:t=fill,"
            f"{text_filter('2  SCREEN THE ENTIRE PIPELINE', 30, 92, 840, gold)},"
            f"{text_filter('Listings + city filings, ranked by live returns', 43, 92, 895)},"
            f"{text_filter('Search. Filter. Compare. Save.', 25, 94, 964, 'white@0.82')},"
            "format=yuv420p[v2]"
        ),
        (
            "[3:v]scale=1920:1080,"
            "drawbox=x=1190:y=84:w=650:h=94:color=0x07162D@0.92:t=fill,"
            f"{text_filter('3  SET YOUR UNDERWRITING', 30, 1222, 108)},"
            f"{text_filter('Saved once. Applied everywhere.', 22, 1224, 148, gold)},"
            "format=yuv420p[v3]"
        ),
        (
            "[4:v]scale=1920:1080,"
            "drawbox=x=0:y=0:w=610:h=1080:color=0x07162D@0.88:t=fill,"
            f"{text_filter('4  VERIFY THE DEAL', 30, 76, 280, gold)},"
            f"{text_filter('Ownership + APNs', 44, 76, 350)},"
            f"{text_filter('Sales + debt', 44, 76, 410)},"
            f"{text_filter('Plans + determinations', 44, 76, 470)},"
            f"{text_filter('Source-backed evidence beside the numbers.', 22, 80, 560, 'white@0.82')},"
            "format=yuv420p[v4]"
        ),
        (
            "[5:v]scale=1920:1080,"
            "drawbox=x=0:y=0:w=iw:h=148:color=0x07162D@0.93:t=fill,"
            f"{text_filter('5  EXPORT THE SAME LIVE MODEL', 29, 82, 38, gold)},"
            f"{text_filter('Formula-driven Excel + source-backed PDF', 40, 650, 32)},"
            "format=yuv420p[v5]"
        ),
        (
            "[6:v]scale=-1:1080,crop=1920:1080:x='(in_w-out_w)*0.5':y=0,"
            "drawbox=x=0:y=0:w=iw:h=ih:color=0x07162D@0.82:t=fill,"
            f"{text_filter('PARCELLA', 82, 110, 330)},"
            f"{text_filter('Stop browsing. Start underwriting.', 48, 110, 445, gold)},"
            f"{text_filter('parcel-la.vercel.app', 29, 114, 535, 'white@0.82')},"
            "format=yuv420p[v6]"
        ),
        "[v0][v1]xfade=transition=fade:duration=0.2:offset=1.8[x1]",
        "[x1][v2]xfade=transition=fade:duration=0.2:offset=5.3[x2]",
        "[x2][v3]xfade=transition=fade:duration=0.2:offset=8.3[x3]",
        "[x3][v4]xfade=transition=fade:duration=0.2:offset=11.5[x4]",
        "[x4][v5]xfade=transition=fade:duration=0.2:offset=14.5[x5]",
        "[x5][v6]xfade=transition=fade:duration=0.2:offset=17.3[outv]",
        "[7:a]aresample=48000,volume=1.05,afade=t=in:st=0:d=0.1,afade=t=out:st=19.3:d=0.6[aout]",
    ]
    command = [
        ffmpeg_executable(),
        "-y",
        "-loop", "1", "-t", "2.0", "-i", str(dashboard),
        "-loop", "1", "-t", "3.7", "-i", str(feasibility),
        "-loop", "1", "-t", "3.2", "-i", str(dashboard),
        "-loop", "1", "-t", "3.4", "-i", str(settings),
        "-loop", "1", "-t", "3.2", "-i", str(records),
        "-loop", "1", "-t", "3.0", "-i", str(exports),
        "-loop", "1", "-t", "2.7", "-i", str(dashboard),
        "-i", str(voice),
        "-filter_complex", ";".join(filters),
        "-map", "[outv]",
        "-map", "[aout]",
        "-r", "30",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "160k",
        "-shortest",
        "-movflags", "+faststart",
        str(OUTPUT),
    ]
    subprocess.run(command, check=True)
    print(f"Created {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
