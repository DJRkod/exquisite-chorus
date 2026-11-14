"""Tests for deploy_render.py. No network: urlopen is patched to fail, and the
live-path tests swap in a fake Render API.

Run with:  python -m unittest discover -s scripts -p "test_*.py"
"""
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_render as deploy  # noqa: E402

SECRETS = {
    "MONGODB_URI": "mongodb+srv://app:Hunter2PasswordXyz@cluster0.example.mongodb.net/exquisite-chorus",
    "SESSION_SECRET": "s3ss10n-secret-value-that-is-long-enough-0123456789",
    "AWS_ACCESS_KEY_ID": "AKIAFAKEFAKEFAKE1234",
    "AWS_SECRET_ACCESS_KEY": "fakeSecretAccessKeyValue/abcdefghijklmnop",
}
PUBLIC = {
    "APP_ORIGIN": "https://exquisite-chorus.onrender.com",
    "AWS_REGION": "us-east-2",
    "S3_BUCKET": "exquisite-chorus-audio",
}
RENDER_KEY = "rnd_fakeRenderApiKey123456"


def no_network(*_args, **_kwargs):
    raise AssertionError("network call attempted")


class DeployRenderTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env_file = self.root / ".env.production"
        self.key_file = self.root / ".render_api_key"
        self.write_env({**SECRETS, **PUBLIC})
        self.key_file.write_text("RENDER_API_KEY=%s\n" % RENDER_KEY, encoding="utf-8")
        patch = mock.patch.object(deploy.urllib.request, "urlopen", side_effect=no_network)
        self.urlopen = patch.start()
        self.addCleanup(patch.stop)

    def write_env(self, values):
        lines = ["# production settings"] + ['%s="%s"' % kv for kv in values.items()]
        self.env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def run_main(self, *extra):
        stdout, stderr = io.StringIO(), io.StringIO()
        argv = ["--env-file", str(self.env_file), "--key-file", str(self.key_file), *extra]
        code = None
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                code = deploy.main(argv)
            except SystemExit as exit_:
                code = exit_.code
        return code, stdout.getvalue() + stderr.getvalue()

    def test_dry_run_prints_names_and_config_without_network(self):
        code, output = self.run_main("--dry-run")
        self.assertEqual(code, 0)
        self.urlopen.assert_not_called()
        for name in deploy.ENV_KEYS:
            self.assertIn(name, output)
        self.assertIn("env vars (10)", output)
        self.assertIn("npm ci --include=dev && npm run build", output)
        self.assertIn("/api/health", output)
        self.assertIn("DJRkod/exquisite-chorus", output)

    def test_dry_run_never_prints_secret_values(self):
        _, output = self.run_main("--dry-run")
        for value in [*SECRETS.values(), "Hunter2PasswordXyz", RENDER_KEY]:
            self.assertNotIn(value, output)

    def test_missing_required_variables_are_named_and_stop_before_network(self):
        self.write_env({"APP_ORIGIN": PUBLIC["APP_ORIGIN"]})
        code, output = self.run_main("--dry-run")
        self.assertIn("MONGODB_URI", str(code))
        self.assertIn("SESSION_SECRET", str(code))
        self.urlopen.assert_not_called()
        self.assertNotIn(PUBLIC["APP_ORIGIN"], output)

    def test_defaults_fill_node_env_trust_proxy_and_node_version(self):
        env_vars, missing = deploy.build_env_vars({**SECRETS, **PUBLIC})
        self.assertEqual(missing, [])
        values = {v["key"]: v["value"] for v in env_vars}
        self.assertEqual(values["NODE_ENV"], "production")
        self.assertEqual(values["TRUST_PROXY"], "1")
        self.assertEqual(values["NODE_VERSION"], "24")

    def test_env_file_values_override_defaults(self):
        env_vars, _ = deploy.build_env_vars({**SECRETS, **PUBLIC, "NODE_VERSION": "24.20.0"})
        self.assertIn({"key": "NODE_VERSION", "value": "24.20.0"}, env_vars)

    def test_create_payload_is_a_free_node_service_with_health_check(self):
        args = deploy.parse_args(["--name", "svc", "--branch", "feat/x", "--region", "oregon"])
        env_vars, _ = deploy.build_env_vars({**SECRETS, **PUBLIC})
        payload = deploy.create_payload(args, "owner-1", env_vars)
        details = payload["serviceDetails"]
        self.assertEqual(payload["branch"], "feat/x")
        self.assertEqual(payload["repo"], deploy.DEFAULT_REPO)
        self.assertEqual(details["plan"], "free")
        self.assertEqual(details["region"], "oregon")
        self.assertEqual(details["healthCheckPath"], "/api/health")
        self.assertEqual(details["envSpecificDetails"]["buildCommand"], "npm ci --include=dev && npm run build")
        self.assertEqual(details["envSpecificDetails"]["startCommand"], "npm start")

    def test_api_key_is_read_from_assignment_or_bare_line(self):
        self.assertEqual(deploy.read_api_key(self.key_file), RENDER_KEY)
        self.key_file.write_text(RENDER_KEY + "\n", encoding="utf-8")
        self.assertEqual(deploy.read_api_key(self.key_file), RENDER_KEY)
        self.assertIsNone(deploy.read_api_key(self.root / "missing"))

    def test_scrub_removes_secret_values_from_error_text(self):
        text = "bad value %s for key" % SECRETS["SESSION_SECRET"]
        self.assertNotIn(SECRETS["SESSION_SECRET"], deploy.scrub(text, SECRETS.values()))


    def test_http_error_body_is_scrubbed_before_it_reaches_the_terminal(self):
        body = ("rejected %s and %s" % (RENDER_KEY, SECRETS["AWS_SECRET_ACCESS_KEY"])).encode()
        self.urlopen.side_effect = deploy.urllib.error.HTTPError(
            deploy.BASE + "/services", 400, "Bad Request", {}, io.BytesIO(body))
        call = deploy.make_caller(RENDER_KEY, [RENDER_KEY, *SECRETS.values()])

        with self.assertRaises(SystemExit) as raised:
            call("POST", "/services", {"x": 1})

        message = str(raised.exception.code)
        self.assertIn("HTTP 400", message)
        self.assertIn("[redacted]", message)
        self.assertNotIn(RENDER_KEY, message)
        self.assertNotIn(SECRETS["AWS_SECRET_ACCESS_KEY"], message)

    def run_live(self, existing):
        """Runs main() against a fake Render API; returns (code, output, calls, secrets)."""
        calls, secrets = [], []
        service = {"id": "srv-1", "name": "exquisite-chorus",
                   "serviceDetails": {"url": "https://exquisite-chorus.onrender.com"}}

        def fake_call(method, path, body=None):
            calls.append((method, path, body))
            if path.startswith("/owners"):
                return [{"owner": {"id": "own-1"}}]
            if method == "GET" and path.startswith("/services?"):
                return [{"service": service}] if existing else []
            if method == "POST" and path == "/services":
                return {"service": service}
            if method == "POST" and path.endswith("/deploys"):
                return {"id": "dep-1"}
            if path == "/services/srv-1/deploys/dep-1" or path.startswith("/services/srv-1/deploys?"):
                return {"status": "live"} if existing else [{"deploy": {"status": "live"}}]
            return {}

        def fake_make_caller(key, values):
            secrets.extend(values)
            return fake_call

        with mock.patch.object(deploy, "make_caller", fake_make_caller):
            code, output = self.run_main()
        return code, output, calls, secrets

    def test_live_run_creates_the_service_when_none_exists(self):
        code, output, calls, secrets = self.run_live(existing=False)

        self.assertEqual(code, 0)
        create = next(body for method, path, body in calls if method == "POST" and path == "/services")
        self.assertEqual(create["ownerId"], "own-1")
        self.assertEqual(len(create["envVars"]), len(deploy.ENV_KEYS))
        self.assertFalse(any(method in ("PATCH", "PUT") for method, _, _ in calls))
        self.assertIn("created", output)
        self.assertIn("deploy: live", output)
        # Every value the service gets, and the API key, are scrubbed from errors.
        self.assertIn(RENDER_KEY, secrets)
        for value in SECRETS.values():
            self.assertIn(value, secrets)
        for value in [*SECRETS.values(), RENDER_KEY]:
            self.assertNotIn(value, output)

    def test_live_run_updates_settings_env_vars_and_deploys_an_existing_service(self):
        code, output, calls, _ = self.run_live(existing=True)

        self.assertEqual(code, 0)
        methods = [(method, path) for method, path, _ in calls]
        self.assertIn(("PATCH", "/services/srv-1"), methods)
        self.assertIn(("PUT", "/services/srv-1/env-vars"), methods)
        self.assertIn(("POST", "/services/srv-1/deploys"), methods)
        self.assertNotIn(("POST", "/services"), methods)
        self.assertIn("deploy triggered", output)
        self.assertIn("deploy: live", output)

    def test_wait_for_deploy_stops_on_live_failure_or_timeout(self):
        def statuses(*values):
            answers = iter(values)
            return lambda method, path, body=None: {"status": next(answers)}

        with mock.patch.object(deploy.time, "sleep") as sleep, contextlib.redirect_stdout(io.StringIO()):
            deploy.wait_for_deploy(statuses("build_in_progress", "live"), "srv-1", "dep-1")
            self.assertEqual(sleep.call_count, 1)

            with self.assertRaises(SystemExit) as failed:
                deploy.wait_for_deploy(statuses("build_failed"), "srv-1", "dep-1")
            self.assertIn("build_failed", str(failed.exception.code))

            with self.assertRaises(SystemExit) as timed_out:
                deploy.wait_for_deploy(statuses(*["build_in_progress"] * 3), "srv-1", "dep-1", attempts=3)
            self.assertIn("did not finish", str(timed_out.exception.code))


if __name__ == "__main__":
    unittest.main()
