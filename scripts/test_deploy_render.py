"""Tests for deploy_render.py. No network: urlopen is patched to fail.

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


if __name__ == "__main__":
    unittest.main()
