# server/services/larkcli.py
import subprocess
import json
import logging
import shutil

logger = logging.getLogger(__name__)


class LarkCliError(Exception):
    """Raised when a lark-cli command fails."""
    def __init__(self, message: str, returncode: int = 1):
        super().__init__(message)
        self.returncode = returncode


def is_installed() -> bool:
    return shutil.which("lark-cli") is not None


def run(*args: str, timeout: int = 60) -> dict:
    cmd = ["lark-cli", *args]
    logger.info("lark-cli %s", " ".join(args))
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise LarkCliError(f"lark-cli timed out after {timeout}s")
    except FileNotFoundError:
        raise LarkCliError("lark-cli not found. Run ./start-server.sh for setup.")
    if result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip() or "Unknown error"
        logger.error("lark-cli failed (rc=%d): %s", result.returncode, err)
        raise LarkCliError(err, result.returncode)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"raw": result.stdout.strip()}


def get_auth_status() -> dict:
    return run("auth", "status")
