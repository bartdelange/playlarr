import logging

import uvicorn


def run(*, debug: bool = False) -> None:
    """Launch the local-only GUI on a fixed application port."""
    logging.basicConfig(
        level=logging.DEBUG if debug else logging.INFO, format="%(levelname)s: %(message)s"
    )
    uvicorn.run(
        "music_importer.web.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=8787,
        log_level="debug" if debug else "info",
    )
