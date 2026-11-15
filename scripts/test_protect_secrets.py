"""Tests for protect_secrets.py.

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
import protect_secrets as protector  # noqa: E402

DOTENV = """\
# local development
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:5173
TRUST_PROXY=1
MONGODB_URI=mongodb+srv://app:Pa%40ssw0rdLong@cluster0.example.mongodb.net/exquisite-chorus
SESSION_SECRET="local-session-secret-0123456789abcdef"
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=AKIAFAKEDEVKEY123456
AWS_SECRET_ACCESS_KEY=devSecretAccessKey/abcdefghijklmnop
S3_BUCKET=exquisite-chorus-audio-dev
"""
PRODUCTION = """\
NODE_ENV=production
SESSION_SECRET=prod-session-secret-0123456789abcdefghij
AWS_SECRET_ACCESS_KEY=devSecretAccessKey/abcdefghijklmnop
"""
AWS_INI = """\
[default]
aws_access_key_id = AKIAFAKEINIKEY123456
aws_secret_access_key = iniSecretAccessKey/abcdefghijklmnop
region = us-east-2
"""


class ProtectSecretsTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.redact = self.root / ".llm_log_redact.txt"
        self.files = {
            ".env": DOTENV,
            ".env.production": PRODUCTION,
            ".render_api_key": "rnd_bareRenderKey123456\n",
            ".aws_credentials": AWS_INI,
        }
        for name, text in self.files.items():
            (self.root / name).write_text(text, encoding="utf-8")
        self.sources = [self.root / name for name in self.files] + [self.root / "absent"]

    def terms(self):
        return [t for t in self.redact.read_text(encoding="utf-8").splitlines() if t]

    def test_secret_keys_and_url_passwords_are_collected(self):
        protector.protect(self.sources, self.redact)
        terms = self.terms()
        for value in ["Pa%40ssw0rdLong", "Pa@ssw0rdLong",
                      "local-session-secret-0123456789abcdef",
                      "prod-session-secret-0123456789abcdefghij",
                      "AKIAFAKEDEVKEY123456", "devSecretAccessKey/abcdefghijklmnop",
                      "rnd_bareRenderKey123456",
                      "AKIAFAKEINIKEY123456", "iniSecretAccessKey/abcdefghijklmnop"]:
            self.assertIn(value, terms)

    def test_non_secret_settings_are_not_listed(self):
        protector.protect(self.sources, self.redact)
        joined = "\n".join(self.terms())
        for value in ["development", "production", "3000", "http://localhost:5173",
                      "us-east-2", "exquisite-chorus-audio-dev", "cluster0.example.mongodb.net"]:
            self.assertNotIn(value, joined)

    def test_values_are_deduplicated_within_and_across_runs(self):
        self.redact.write_text("existing-term\nAKIAFAKEDEVKEY123456", encoding="utf-8")
        _, added = protector.protect(self.sources, self.redact)
        terms = self.terms()
        self.assertEqual(len(terms), len(set(terms)))
        self.assertEqual(terms[0], "existing-term")
        self.assertEqual(terms.count("devSecretAccessKey/abcdefghijklmnop"), 1)
        self.assertEqual(protector.protect(self.sources, self.redact), (len(terms), 0))
        self.assertEqual(added, len(terms) - 2)

    def test_placeholders_and_short_values_are_skipped(self):
        path = self.root / ".env"
        path.write_text("SESSION_SECRET=change-me-to-a-long-random-string\n"
                        "AWS_ACCESS_KEY_ID=\nAWS_SECRET_ACCESS_KEY=short\n", encoding="utf-8")
        self.assertEqual(protector.collect([path]), [])

    def test_main_prints_only_counts(self):
        stdout = io.StringIO()
        with mock.patch.object(protector, "SOURCES", self.sources), \
                mock.patch.object(protector, "REDACT", self.redact), \
                contextlib.redirect_stdout(stdout):
            self.assertEqual(protector.main(), 0)
        output = stdout.getvalue()
        self.assertRegex(output, r"^protect_secrets: 0 term\(s\) already listed, \d+ added\n$")
        for term in self.terms():
            self.assertNotIn(term, output)


if __name__ == "__main__":
    unittest.main()
