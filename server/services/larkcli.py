# server/services/larkcli.py
import subprocess
import json
import logging
from typing import Optional
logger = logging.getLogger(__name__)


class LarkCliError(Exception):
    """Raised when a lark-cli command fails."""
    def __init__(self, message: str, returncode: int = 1):
        super().__init__(message)
        self.returncode = returncode


def run(*args: str, timeout: int = 60, stdin: Optional[str] = None) -> dict:
    cmd = ["lark-cli", *args]
    logger.info("lark-cli %s", " ".join(args))
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=stdin)
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
    except json.JSONDecodeError as e:
        logger.warning("lark-cli output is not valid JSON (stdout len=%d): %s", len(result.stdout), e)
        return {"raw": result.stdout.strip()}


def get_auth_status() -> dict:
    return run("auth", "status")
