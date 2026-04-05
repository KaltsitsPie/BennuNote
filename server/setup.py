"""Interactive setup for BennuNote server secrets."""

import getpass
import sys

from config import load_config, save_config, is_config_complete, SENSITIVE_KEYS, _redact

PROMPTS = {
    "feishu_app_id": ("Feishu App ID", "cli_xxxxxxxx", False),
    "feishu_app_secret": ("Feishu App Secret", None, True),
    "claude_setup_token": ("Claude Setup Token", "sk-ant-...", True),
}


def run_setup() -> None:
    config = load_config()

    print("\n=== BennuNote Server Setup ===\n")

    # Show current status
    all_set = True
    for key in SENSITIVE_KEYS:
        val = config.get(key, "")
        label = PROMPTS[key][0]
        if val:
            print(f"  [ok] {label}: {_redact(val)}")
        else:
            print(f"  [--] {label}: not configured")
            all_set = False

    if all_set:
        print("\nAll secrets configured. Starting server...\n")
        return

    print("\nPlease configure the missing items (press Enter to skip):\n")

    changed = False
    for key in SENSITIVE_KEYS:
        if config.get(key):
            continue

        label, placeholder, is_secret = PROMPTS[key]
        hint = f" ({placeholder})" if placeholder else ""
        prompt_text = f"  {label}{hint}: "

        if is_secret:
            value = getpass.getpass(prompt_text)
        else:
            value = input(prompt_text)

        value = value.strip()
        if value:
            config[key] = value
            changed = True
        else:
            print(f"    Skipped. {label} features will be unavailable.")

    if changed:
        save_config(config)
        print("\nConfig saved.")

    if is_config_complete():
        print("All secrets configured. Starting server...\n")
    else:
        missing = [PROMPTS[k][0] for k in SENSITIVE_KEYS if not config.get(k)]
        print(f"\nStarting server (missing: {', '.join(missing)})...\n")


if __name__ == "__main__":
    try:
        run_setup()
    except KeyboardInterrupt:
        print("\n\nSetup cancelled. Starting server without changes...\n")
        sys.exit(0)
