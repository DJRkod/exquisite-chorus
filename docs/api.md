# Exquisite Chorus API integration guide

This is the server contract for the project, feed and contribution screens. All paths are relative to the same-origin application. The frontend's `client/src/api/client.ts` already provides a generic `request<T>(method, path, body?)` helper and recording/auth helpers. The request and response types live in `shared/src/` and can be imported from `@exquisite-chorus/shared`.

## Common conventions

- Use JSON for API request bodies and the `ec.sid` session cookie (the browser handles the cookie; use same-origin credentials). Signup and login establish a session. The server rejects disallowed origins on writes.
- Except for logout and version approval/unapproval (204 with no body), responses use `{ "message": "...", "data": ... }`. Errors use the same envelope with `data: null`. The client helper unwraps successful `data` and throws an `ApiError` for failures.
- IDs are strings containing 24 hexadecimal characters. Dates are ISO 8601 strings. Missing optional metadata is returned as `null`; names may be omitted if the related user is unavailable.
- `GET /api/health` and `GET /api/tags` are public. Project and recording routes require login.

## Endpoint reference

| Method and path | Input | Success data |
| --- | --- | --- |
| GET `/api/health` | None | 200, `{ db }` |
| POST `/api/auth/signup` | `SignUpRequest` | 201, `PublicUser` |
| POST `/api/auth/login` | `SignInRequest` | 200, `PublicUser` |
| POST `/api/auth/logout` | No body | 204, empty |
| GET `/api/auth/me` | None | 200, `PublicUser` |
| GET `/api/tags` | None | 200, `TagOptionsDto` |
| POST `/api/recordings` | `CreateUploadRequest` | 201, `CreateUploadResponse` |
| POST `/api/recordings/:id/confirm` | `ConfirmUploadRequest` | 200, `RecordingDto` |
| GET `/api/recordings` | None | 200, `RecordingDto[]` (up to 100 ready recordings) |
| GET `/api/recordings/:id/playback-url` | None | 200, `PlaybackUrlResponse` |
| POST `/api/projects` | `CreateProjectRequest` | 201, `ProjectDto` |
| GET `/api/projects` | Optional filters below | 200, `ProjectDto[]` |
| GET `/api/projects/:id` | Project ID | 200, `ProjectDto` |
| PATCH `/api/projects/:id` | `UpdateProjectRequest` (owner only) | 200, `ProjectDto` |
| GET `/api/projects/:id/contributions` | Project ID | 200, `ContributionDto[]`, newest first |
| POST `/api/projects/:id/contributions` | `CreateContributionRequest` | 201, `ContributionDto` |
| PUT `/api/projects/:id/contributions/:version/approval` | No body, owner only | 204, empty |
| DELETE `/api/projects/:id/contributions/:version/approval` | No body, owner only | 204, empty |

### Authentication and picker options

Signup accepts `email`, `password` (8–128 characters), `displayName` and optional `skills` (array from the vocabulary). Login accepts `email` and `password`. `PublicUser` returns `id`, `email`, `displayName` and `skills`.

`GET /api/tags` returns `skills`, `genres`, `moods`, `musicalKeys`, `bpmMin` and `bpmMax`. Use these values in pickers instead of guessing spelling. Alternatively import the runtime vocabulary from `@exquisite-chorus/shared/vocabulary`.

### Audio upload (before project or contribution submission)

1. `POST /api/recordings` with `{ "contentType": "audio/mp4", "size": 1000 }` (use the actual file's MIME type and byte count). Accepted types begin with `audio/`, and size must be between one byte and 20 MiB (20 * 1024 * 1024 bytes).
2. Read `recordingId`, `url` and `fields` from the response. Build `FormData` with every returned field, then append the file under `file` **last**. Send a direct POST to the provided S3 `url`. Do not send this multipart body through the JSON API helper; do not manually set the multipart Content-Type. The presigned form expires after five minutes.
3. Only after S3 accepts the upload, `POST /api/recordings/:id/confirm` with `{}` or `{ "durationMs": 2000 }`. Duration is optional (1–1,800,000 milliseconds). A successful response has `status: "ready"`.
4. Pass that `recordingId` to project creation or contribution submission. Each recording may be attached only once and must belong to the submitting user.
5. For playback or download, request `GET /api/recordings/:id/playback-url`. Use the returned `url` (expires in one hour; `expiresAt` is included). Request a fresh URL when it expires. Do not store or expose permanent S3 object keys.

### Create a project

`POST /api/projects`

```json
{
  "title": "Guitar riff",
  "description": "Looking for a drummer",
  "recordingId": "<confirmed recording id>",
  "genre": "Rock",
  "mood": "Driving",
  "musicalKey": "G major",
  "bpm": 120,
  "needs": ["Drums"]
}
```

Required: title (1–140 characters) and at least one valid skill in `needs`. Optional: description (up to 2000 characters), BPM (integer 20–400), genre, mood, musicalKey, recordingId. For the normal publish UI, require audio before calling this endpoint even though the API allows metadata-only projects for demo compatibility. Owner is taken from the session, not the request body. Creation also creates version 1 of the history.

`ProjectDto` includes `id`, `ownerId`, optional `ownerDisplayName`, `title`, `description`, `bpm`, `musicalKey`, `genre`, `mood`, `needs`, `status`, `currentVersion`, `createdAt`, `updatedAt`.

### Browse and filter projects

`GET /api/projects` returns up to 50 open projects, most recently updated first. There is no pagination in this implementation. Supported filters (combine using `URLSearchParams`):

| Parameter | Meaning |
| --- | --- |
| `matched=true` | Open projects needing at least one of the session user's skills, excluding their own projects |
| `mine=true` | The session user's own projects, including closed ones |
| `genre` | Exact genre from vocabulary |
| `mood` | Exact mood from vocabulary |
| `musicalKey` | Exact key from vocabulary |
| `bpm` | Exact integer BPM |
| `need` | One requested skill; when matched is true, both conditions must hold |

`mine` and `matched` cannot both be true. Boolean values must be `true` or `false`. For example, `/api/projects?matched=true&genre=Rock&need=Drums`.

### Open a project and show version history

Fetch `GET /api/projects/:id` for the metadata, and `GET /api/projects/:id/contributions` for the versions. `ContributionDto` includes `id`, `projectId`, `contributorId`, optional `contributorDisplayName`, `version`, `note`, `recordingId`, `createdAt`, and optional `parentVersion`, `approved`, `skillsAdded`. History is newest numbered version first. Version 1 has a null parent; each later version references an older version of the same project. Legacy entries without metadata may be treated as linear (`version - 1`), unapproved, with no skills recorded. `currentVersion` is the highest published version number, not a canonical or approved mix. The version tree may open on the newest approved version or the original if none are approved. Use each selected version’s non-null `recordingId` for playback or download; note-only versions do not have audio.

### Submit a contribution

`POST /api/projects/:id/contributions`

```json
{
  "recordingId": "<new confirmed recording id>",
  "note": "Added drums",
  "baseVersion": 1,
  "skillsAdded": ["Drums"],
  "needs": ["Bass"]
}
```

Supply the version the musician actually listened to as `baseVersion` (positive integer). Any existing published version in this project can be the parent, including an older one. A nonexistent parent returns 404; if omitted, the latest published version is used. Supply a new confirmed recording and/or a note (up to 500 characters). `skillsAdded` is optional and accepts a possibly empty array of vocabulary skills; duplicates are removed. New versions are unapproved, and the server assigns their version number and parent. Omit `needs` to preserve the project-wide list, or send a nonempty skill list to update it (not branch-specific). Successful submission increments `currentVersion`; reload the project and feed. Concurrent submissions may return 409; refresh and retry with the same chosen parent if it still exists. The normal musical flow should supply the amended audio; the API also accepts note-only contributions for lyrics.

### Approve or unapprove a version

Send `PUT /api/projects/:id/contributions/:version/approval` to approve and `DELETE` to unapprove, with no request body. `:version` is the positive integer version number, not a contribution ID. Both return 204 with an empty body and are idempotent. Only the project owner may change approval (403 for other signed-in users). Multiple versions may be approved at once, including the original; approvals can also change on closed projects. All signed-in viewers can read approval flags in history. Approving a version does not change the currently selected version, remove other approvals, or update the highest published version number.

### Edit, close or reopen

`PATCH /api/projects/:id` accepts one or more of `title`, `description`, `bpm`, `musicalKey`, `genre`, `mood`, `needs`, `status`. Omit fields you are not changing. Set optional metadata fields to `null` to clear them. Only the owner may edit. Set `status` to `closed` or `open`; closed projects are hidden from the general/matched feed and cannot accept contributions, but remain accessible by ID and in the owner's list. There is no delete endpoint.

## Error handling

| Status | UI action |
| --- | --- |
| 400 | Display the server message and correct invalid fields or query parameters |
| 401 | Prompt for sign-in |
| 403 | Show permission denied (owner-only edits or disallowed origin) |
| 404 | Show missing project/recording/version; a recording not owned by the submitter also returns 404 on attachment |
| 409 | Refresh after a concurrent write, confirm unfinished uploads, or report a recording already attached/closed project; duplicate records may also return this status |
| 415 | Send JSON for API writes |
| 422 | Recording upload rejected |
| 429 | Wait before retrying signup or login |
| 500 | Show a generic server error; do not expose internals |
| 503 | Audio storage not configured |

## Integration checks

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run lint` from the repo root (Node 24). `server/test/collaboration.test.ts` tests the API workflow using in-memory MongoDB, independent cookie sessions, fake S3 credentials and mocked S3 commands. It does not upload or play real audio.

Before the final demo, repeat the workflow in the browser against a configured development deployment: sign up as a guitarist and a drummer, upload a short test audio file, publish a project, discover and listen as the drummer, upload the amended mix, confirm the version history and skill handoff, then close the project as owner. Verify real S3 upload, confirmation, signed playback, CORS and session cookies. Do not use real credentials or production data in the automated tests.

Known MVP limits: original audio and baseVersion are optional at the API level; note-only versions may not have audio. Multi-document writes use conditional updates and compensating cleanup, not crash-atomic transactions. The API's audio playback URLs are available to authenticated users for ready recordings; projects are collaborative, not private.
