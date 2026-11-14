#!/usr/bin/env python3
"""Create (or update) the Render web service for Exquisite Chorus and wait for
the deploy to finish.

Reads the Render API key from the gitignored .render_api_key (either a
`RENDER_API_KEY=...` line or the bare key) and the service's environment
variables from the gitignored .env.production. Prints variable names and
counts only, never values. Python standard library only.

Usage:
  python scripts/deploy_render.py --dry-run          # show intended config, no network
  python scripts/deploy_render.py                    # create or update, deploy, wait
  python scripts/deploy_render.py --name NAME --branch BRANCH --region ohio \\
      --repo https://github.com/DJRkod/exquisite-chorus --env-file .env.production

See docs/setup.md for the values .env.production needs.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://api.render.com/v1"

DEFAULT_REPO = "https://github.com/DJRkod/exquisite-chorus"
BUILD_COMMAND = "npm ci --include=dev && npm run build"
START_COMMAND = "npm start"
HEALTH_CHECK_PATH = "/api/health"

# Every variable the service gets, in this order. Values come from the env file.
ENV_KEYS = [
    "NODE_ENV", "TRUST_PROXY", "APP_ORIGIN", "MONGODB_URI", "SESSION_SECRET",
    "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET", "NODE_VERSION",
]
# Used when the env file leaves these out; all other keys are required.
DEFAULTS = {"NODE_ENV": "production", "TRUST_PROXY": "1", "NODE_VERSION": "24"}

FAILED = {"build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"}


def read_env_file(path):
    """Parse KEY=VALUE lines, skipping blanks and comments and stripping quotes."""
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def read_api_key(path):
    """Return the Render key from `RENDER_API_KEY=...` or a lone key line."""
    if not path.exists():
        return None
    key = read_env_file(path).get("RENDER_API_KEY")
    if key:
        return key
    lines = [ln.strip() for ln in path.read_text(encoding="utf-8-sig").splitlines()
             if ln.strip() and not ln.strip().startswith("#")]
    return lines[0] if len(lines) == 1 and "=" not in lines[0] else None


def build_env_vars(env):
    """Return (Render envVars list, missing key names) for ENV_KEYS."""
    env_vars, missing = [], []
    for name in ENV_KEYS:
        value = env.get(name) or DEFAULTS.get(name)
        if value:
            env_vars.append({"key": name, "value": value})
        else:
            missing.append(name)
    return env_vars, missing


def service_details(region):
    return {
        "runtime": "node",
        "region": region,
        "plan": "free",
        "healthCheckPath": HEALTH_CHECK_PATH,
        "envSpecificDetails": {"buildCommand": BUILD_COMMAND, "startCommand": START_COMMAND},
    }


def create_payload(args, owner_id, env_vars):
    return {
        "type": "web_service",
        "name": args.name,
        "ownerId": owner_id,
        "repo": args.repo,
        "branch": args.branch,
        "autoDeploy": "yes",
        "envVars": env_vars,
        "serviceDetails": service_details(args.region),
    }


def describe(args, env_vars):
    """Lines describing the intended service. Names only, never values."""
    return [
        "service: %s" % args.name,
        "repo: %s (branch %s)" % (args.repo, args.branch),
        "region: %s, plan: free, runtime: node" % args.region,
        "build: %s" % BUILD_COMMAND,
        "start: %s" % START_COMMAND,
        "health check: %s" % HEALTH_CHECK_PATH,
        "env vars (%d): %s" % (len(env_vars), ", ".join(v["key"] for v in env_vars)),
    ]


def scrub(text, secrets):
    for secret in secrets:
        if secret and len(secret) >= 4:
            text = text.replace(secret, "[redacted]")
    return text


def make_caller(key, secrets):
    def call(method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(BASE + path, data=data, method=method)
        request.add_header("Authorization", "Bearer " + key)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                text = response.read().decode()
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as error:
            detail = scrub(error.read().decode(errors="replace"), secrets)
            raise SystemExit("Render API %s %s failed: HTTP %d\n%s" % (method, path, error.code, detail))
    return call


def wait_for_deploy(call, service_id, deploy_id=None, attempts=60, interval=15):
    for _ in range(attempts):
        if deploy_id:
            status = call("GET", "/services/%s/deploys/%s" % (service_id, deploy_id)).get("status", "pending")
        else:
            deploys = call("GET", "/services/%s/deploys?limit=1" % service_id)
            status = deploys[0]["deploy"]["status"] if deploys else "pending"
        if status == "live":
            print("deploy: live")
            return
        if status in FAILED:
            raise SystemExit("deploy: %s (see the Render dashboard logs)" % status)
        print("deploy: %s..." % status)
        time.sleep(interval)
    raise SystemExit("deploy did not finish in time; check the Render dashboard")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Create or update the Render web service.")
    parser.add_argument("--name", default="exquisite-chorus", help="Render service name")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub repo URL")
    parser.add_argument("--branch", default="main", help="branch Render deploys")
    parser.add_argument("--region", default="ohio", help="Render region (ohio pairs with us-east-2)")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.production",
                        help="file with the service's env var values (gitignored)")
    parser.add_argument("--key-file", type=Path, default=ROOT / ".render_api_key",
                        help="file with the Render API key (gitignored)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the intended config (names only) and exit; no network calls")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if not args.env_file.exists():
        raise SystemExit("%s not found; see docs/setup.md" % args.env_file.name)
    env_vars, missing = build_env_vars(read_env_file(args.env_file))
    if missing:
        raise SystemExit("%s is missing: %s" % (args.env_file.name, ", ".join(missing)))

    for line in describe(args, env_vars):
        print(line)
    if args.dry_run:
        print("dry run: no changes made")
        return 0

    key = read_api_key(args.key_file)
    if not key:
        raise SystemExit("%s must contain RENDER_API_KEY=<key> or the bare key" % args.key_file.name)
    call = make_caller(key, [key] + [v["value"] for v in env_vars])

    owners = call("GET", "/owners?limit=20")
    if not owners:
        raise SystemExit("no Render workspace found for this API key")
    owner_id = owners[0]["owner"]["id"]

    services = [s["service"] for s in call("GET", "/services?limit=100&name=%s" % args.name)]
    service = next((s for s in services if s["name"] == args.name), None)
    deploy_id = None
    if service is None:
        service = call("POST", "/services", create_payload(args, owner_id, env_vars))["service"]
        print("service: %s (created; first deploy started)" % service["name"])
    else:
        call("PATCH", "/services/%s" % service["id"], {
            "branch": args.branch,
            "serviceDetails": {
                "healthCheckPath": HEALTH_CHECK_PATH,
                "envSpecificDetails": {"buildCommand": BUILD_COMMAND, "startCommand": START_COMMAND},
            },
        })
        call("PUT", "/services/%s/env-vars" % service["id"], env_vars)
        deploy_id = call("POST", "/services/%s/deploys" % service["id"], {}).get("id")
        print("service: %s (exists; settings and %d env vars updated, deploy triggered)"
              % (service["name"], len(env_vars)))
    print("url: %s" % service.get("serviceDetails", {}).get("url", "(see dashboard)"))
    wait_for_deploy(call, service["id"], deploy_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
