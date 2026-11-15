#!/usr/bin/env python3
"""Add every secret value from the gitignored credential files to the LLM log
redaction list, so that llm_logs_raburt3.csv (committed) never contains them
even if a command prints them.

Reads .env, server/.env, .env.production, .render_api_key and .aws_credentials
(whichever exist). Only secret-bearing keys count: SESSION_SECRET,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, RENDER_API_KEY
(or a bare key in .render_api_key), plus any password embedded in a URL such
as MONGODB_URI. Settings like NODE_ENV, AWS_REGION or S3_BUCKET are left alone.
New values are appended, deduplicated, to .llm_log_redact.txt. Prints only
counts, so running it is safe to log. Python standard library only.

Usage: python scripts/protect_secrets.py
"""
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [ROOT / ".env", ROOT / "server" / ".env", ROOT / ".env.production",
           ROOT / ".render_api_key", ROOT / ".aws_credentials"]
REDACT = ROOT / ".llm_log_redact.txt"

SECRET_KEYS = {"SESSION_SECRET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
               "AWS_SESSION_TOKEN", "RENDER_API_KEY"}
URL_CRED = re.compile(r"://([^\s/:@]+):([^\s/@]+)@")
# Placeholders from .env.example and docs are not secrets.
SKIP = {"change-me-to-a-long-random-string", "<password>", "<username>", "<db_password>"}
MIN_LENGTH = 8


def _keep(value):
    return value not in SKIP and len(value) >= MIN_LENGTH


def secrets_in(path):
    """Yield the secret values in one KEY=VALUE (or `key = value` ini) file."""
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith(("#", ";", "[")):
            continue
        if "=" not in line:
            # .render_api_key may hold only the bare key.
            if path.name == ".render_api_key" and _keep(line):
                yield line
            continue
        key, value = line.split("=", 1)
        key = key.strip().upper()
        value = value.strip().strip('"').strip("'")
        for match in URL_CRED.finditer(value):
            password = match.group(2)
            for form in (password, urllib.parse.unquote(password)):
                if _keep(form):
                    yield form
        if key in SECRET_KEYS and "://" not in value and _keep(value):
            yield value


def collect(sources):
    found = []
    for path in sources:
        if path.exists():
            found.extend(secrets_in(path))
    return list(dict.fromkeys(found))


def protect(sources, redact_file):
    """Append unseen secrets to redact_file. Returns (already listed, added)."""
    existing = redact_file.read_text(encoding="utf-8-sig") if redact_file.exists() else ""
    known = {t.strip() for t in existing.splitlines() if t.strip()}
    new = [v for v in collect(sources) if v not in known]
    if new:
        with open(redact_file, "a", encoding="utf-8") as handle:
            if existing and not existing.endswith("\n"):
                handle.write("\n")
            handle.write("\n".join(new) + "\n")
    return len(known), len(new)


def main():
    known, added = protect(SOURCES, REDACT)
    print("protect_secrets: %d term(s) already listed, %d added" % (known, added))
    return 0


if __name__ == "__main__":
    sys.exit(main())
