# Cloud setup and deployment

How to stand up AWS (S3), MongoDB Atlas and Render for Exquisite Chorus, run it locally against
dev resources, and check a deploy. Do the steps in order; the budget alert comes before any upload.

Placeholders: `<bucket>` is the production bucket name, `<service>` the Render service name,
`<region>` the AWS region (default `us-east-2`).

## 1. Prerequisites

1. Node 24 (`.node-version`) and Python 3 (for the scripts in `scripts/`).
2. Access to the GitHub repo `DJRkod/exquisite-chorus`.
3. Accounts: AWS, MongoDB Atlas, Render (sign in to Render with GitHub).
4. Secrets never go in Git. They live only in gitignored files (`.env`,
   `.env.production`, `.render_api_key`, `.aws_credentials`) and in Render's env var settings.
   After creating or changing any of them, run `python scripts/protect_secrets.py` (raburt3's
   machine) so the LLM log redacts them.

## 2. AWS account and budget alert (do this first)

1. Sign in as the account owner. In **Billing and Cost Management → Free plan** (or the account
   menu), confirm the account is on the **Free plan** offered to accounts created after
   July 15, 2025. Stay on it; do not upgrade to a paid plan.
2. **Billing and Cost Management → Budgets → Create budget**:
   - Budget setup: **Customize (advanced)**; type **Cost budget**.
   - Name `exquisite-chorus-5usd`; period **Monthly**; recurring; fixed amount **$5.00**.
   - Alerts: add six thresholds, each emailing the team owner's address:
     50%, 80%, 100% of budgeted amount on **Actual** costs, and 50%, 80%, 100% on
     **Forecasted** costs.
   - Create. Confirm it appears in the Budgets list before uploading anything (R8).
3. Never create or use root access keys. All programmatic access goes through the IAM users below.

## 3. S3 buckets

Create two buckets: production `<bucket>` (e.g. `exquisite-chorus-audio`) and dev `<bucket>-dev`.
Separate buckets plus separate IAM users mean laptop keys can never touch production audio.

For each bucket, in **S3 → Create bucket**:

1. **AWS Region**: `<region>`; it must equal `AWS_REGION` in that environment.
2. **Object Ownership**: **ACLs disabled (Bucket owner enforced)**.
3. **Block Public Access**: leave **Block all public access** checked (all four boxes ON).
4. Versioning off, default encryption SSE-S3 (defaults). Create.

Then open the bucket → **Permissions → Cross-origin resource sharing (CORS) → Edit** and paste.

Production bucket (Render origin only):

```json
[
  {
    "AllowedOrigins": ["https://<service>.onrender.com"],
    "AllowedMethods": ["GET", "HEAD", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Dev bucket (local Vite dev server only):

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173"],
    "AllowedMethods": ["GET", "HEAD", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Lifecycle rules, on both buckets: **Management → Create lifecycle rule**.

1. Rule `expire-pending`: scope **Limit the scope using filters**, prefix `pending/`;
   actions **Expire current versions of objects** after **1** day.
2. Rule `abort-incomplete-multipart`: scope **Apply to all objects** (acknowledge the warning);
   action **Delete expired object delete markers or incomplete multipart uploads → Delete
   incomplete multipart uploads** after **1** day.

The same rules as JSON (for `aws s3api put-bucket-lifecycle-configuration`, if you prefer the CLI):

```json
{
  "Rules": [
    {
      "ID": "expire-pending",
      "Filter": { "Prefix": "pending/" },
      "Status": "Enabled",
      "Expiration": { "Days": 1 }
    },
    {
      "ID": "abort-incomplete-multipart",
      "Filter": {},
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

## 4. IAM users and access keys

Create one user per bucket: `exquisite-chorus-app` (production) and `exquisite-chorus-dev`.

1. **IAM → Users → Create user**; name as above; do **not** grant console access; no groups or
   managed policies. Create.
2. Open the user → **Permissions → Add permissions → Create inline policy → JSON**, paste
   (with that user's bucket name), name it `s3-<bucket>`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "Objects",
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::<bucket>/*"
       },
       {
         "Sid": "ListForNotFound",
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::<bucket>"
       }
     ]
   }
   ```

   `s3:ListBucket` is required: without it S3 answers 403 instead of 404 for a missing object,
   and the recording confirm step relies on telling those apart.
3. **Security credentials → Create access key → Application running outside AWS**. Copy the
   access key ID and secret into the matching env file (production keys → `.env.production`
   and Render; dev keys → your local `.env`). The secret is shown once.
4. If a key may have leaked: deactivate and delete it here, create a new one, update Render/env.

## 5. MongoDB Atlas

1. **Create a project** `exquisite-chorus` → **Create cluster → M0 (Free)**, provider AWS,
   region nearest `<region>` (e.g. `us-east-2` Ohio).
2. **Security → Database Access → Add new database user**: password auth, username e.g.
   `app`, **Autogenerate Secure Password** (copy it). Under **Database User Privileges →
   Specific Privileges** choose **readWrite** on database `exquisite-chorus` only (not
   `readWriteAnyDatabase` / Atlas admin).
   Optional: a second user `app-dev` with readWrite on `exquisite-chorus-dev` for local work.
3. **Security → Network Access → Add IP address → Allow access from anywhere** (`0.0.0.0/0`).
   Render's free plan has no static outbound IPs, so the strong generated password is the guard.
4. **Clusters → Connect → Drivers** and copy the string; insert the password and the database
   name before the `?`:
   `mongodb+srv://app:<password>@<cluster>.mongodb.net/exquisite-chorus?retryWrites=true&w=majority`
   URL-encode the password if it contains `@ : / ? # %`.

## 6. Render web service

The app is one Web Service: Express serves the built client and the API from the same origin.

1. Generate a session secret (48 random bytes, 64 chars):
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
2. **Render dashboard → New → Web Service → Git provider** → pick `DJRkod/exquisite-chorus`.
   - Name `<service>` (gives `https://<service>.onrender.com`); Region **Ohio** (near `us-east-2`).
   - Branch `main` (or the branch being tested); Root Directory empty; Language **Node**.
   - **Build Command**: `npm ci --include=dev && npm run build`
     (`NODE_ENV=production` makes `npm ci` skip devDependencies, which the build needs).
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**.
3. **Environment Variables** (Add from .env works too):

   | Key | Value |
   | --- | --- |
   | `NODE_VERSION` | `24` |
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `1` |
   | `APP_ORIGIN` | `https://<service>.onrender.com` |
   | `MONGODB_URI` | Atlas string from step 5.4 |
   | `SESSION_SECRET` | output of step 6.1 (32+ chars required) |
   | `AWS_REGION` | `<region>` |
   | `AWS_ACCESS_KEY_ID` | production IAM user's key |
   | `AWS_SECRET_ACCESS_KEY` | production IAM user's secret |
   | `S3_BUCKET` | `<bucket>` |

   The server refuses to start in production if `MONGODB_URI`, `SESSION_SECRET`, `APP_ORIGIN`,
   `S3_BUCKET` or `AWS_REGION` is missing, or the secret is under 32 characters.
4. **Advanced → Health Check Path**: `/api/health`. Auto-Deploy: on. **Create Web Service**.
5. Scripted alternative (same settings): put the table's values in `.env.production` (KEY=VALUE,
   gitignored) and the API key from **Account settings → API keys** in `.render_api_key`, then
   ```sh
   python scripts/protect_secrets.py
   python scripts/deploy_render.py --dry-run          # check names and settings
   python scripts/deploy_render.py --name <service> --branch main
   ```
6. If the service URL differs from what you put in `APP_ORIGIN` or the production CORS rule,
   fix both and redeploy.
7. The free instance sleeps after 15 minutes idle; the first request takes about a minute and
   the app shows a wake-up banner meanwhile. Open the URL a minute before demos and grading.

## 7. Local development

1. `npm install`.
2. Copy `.env.example` to `.env` in the repo root and fill it in. Keep
   `NODE_ENV=development`, `APP_ORIGIN=http://localhost:5173`, leave `TRUST_PROXY` empty.
3. Use dev resources only: `S3_BUCKET=<bucket>-dev`, the dev IAM user's keys, and either a local
   MongoDB (`mongodb://localhost:27017/exquisite-chorus`) or the Atlas dev database.
4. `npm run dev`, open http://localhost:5173. Without a database the API still starts and
   `/api/health` reports the database state.

## 8. Post-deploy smoke checklist

Run on the Render URL after each deploy that changes infrastructure; record results in the PR.

- [ ] `https://<service>.onrender.com` loads over HTTPS (padlock, no mixed-content warnings).
- [ ] After 15+ minutes idle, the first load shows the wake-up banner, then the app.
- [ ] `https://<service>.onrender.com/api/health` returns 200 with the database connected.
- [ ] Sign up, reload (still signed in), sign out, sign in again.
- [ ] Upload a recording; it appears in the list; it plays; "play together" plays all tracks in sync.
- [ ] S3 console: the object is under `audio/<userId>/`; nothing lingers under `pending/` after
      confirm.
- [ ] AWS Budgets shows the $5 budget with its alerts.
- [ ] Secret scan: for each secret value, `git grep -F "<value>"` and
      `git log -p -S "<value>"` find nothing, and `llm_logs_raburt3.csv` does not contain it.
      (Type values into the command locally; never paste them into an LLM chat.)
- [ ] Cross-browser matrix: record one clip each in Chrome, Firefox and Safari; play each clip in
      all three browsers; put the 3×3 results table in the PR description.

## 9. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Upload fails with CORS error, `AccessDenied` or `SignatureDoesNotMatch` | Bucket CORS missing the exact origin (scheme, host, no trailing slash); IAM policy missing `s3:PutObject` on `<bucket>/*`; wrong `AWS_REGION`/bucket pair; file type not `audio/*` or over 20 MB. |
| Confirm returns 403 / "access denied" instead of 404 | IAM policy missing `s3:ListBucket` on `arn:aws:s3:::<bucket>` (no `/*`). |
| Playback or "play together" fails but upload works | CORS lacks `GET`/`HEAD` for that origin; presigned URL expired (reload). |
| Signed in, but reload signs you out / cookie not kept | `APP_ORIGIN` not exactly `https://<service>.onrender.com`; `TRUST_PROXY` not `1` so the secure cookie is never set. |
| Build fails with `tsc`/`vite: not found` | Build command lacks `--include=dev`. |
| Deploy fails at start: "Missing required environment variables" or short `SESSION_SECRET` | Add the named variables in Render → Environment; regenerate the secret. |
| Start fails with MongoDB timeout | Atlas Network Access lacks `0.0.0.0/0`, wrong password (URL-encode it), or user lacks `readWrite` on the database named in the URI. |
| Health check keeps failing | Health Check Path must be `/api/health`; see the Render logs. |
