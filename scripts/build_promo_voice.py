"""Generate the natural-speed ParcelLA promo narration with Edge neural TTS."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "assets" / "parcella-tour-voice.mp3"
VOICE = os.environ.get("PARCELLA_TTS_VOICE", "en-US-AvaMultilingualNeural")

SCRIPT = (
    "Parcel L A shows what you can build, and what it is worth. "
    "Compare zoning and incentives with an appraisal-level review of local rent and sales comps. "
    "Apply your rents, costs, financing, and unit sizes. "
    "Verify ownership and plans. "
    "Export complete underwriting to Excel and P D F. "
    "Underwrite the opportunity."
)


async def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    communicator = edge_tts.Communicate(
        SCRIPT,
        VOICE,
        rate="+11%",
        pitch="+0Hz",
        volume="+0%",
    )
    await communicator.save(str(OUTPUT))
    print(f"Created {OUTPUT}")


if __name__ == "__main__":
    asyncio.run(main())
