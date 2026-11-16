# Team roles: sign-up sheet

Five people split into a frontend pair, a backend pair, and a floater. Each area has two people who know it, so the work keeps moving when someone is sick or busy.

**To claim a role:** in the table, change its ☐ to ☑ and put your GitHub username (for example `@octocat`) in the last column. Edit the file on GitHub and open a pull request; the pencil icon does both.

## Nov 17: prototype for the heuristic evaluation

In class on Nov 17, other groups get mouse control of our clickable prototype over Zoom and evaluate it. The course asks for at least 3 key interactions. A prototype is mockup screens linked together so they can be clicked through, not working code.

The prototype is built: open [`prototype/index.html`](prototype/index.html) in a browser (details in [`prototype/README.md`](prototype/README.md)). The evaluators' sheet, with the tasks, Nielsen's 10 heuristics and a findings table, is [`docs/heuristic-evaluation.md`](docs/heuristic-evaluation.md). What's left for Nov 17 is checking it, rehearsing, and running the session.

The three interactions:

1. **Sign up and choose your skills** (instruments, roles)
2. **Start a project:** upload a track, tag it (BPM, key, genre, mood), say what it needs
3. **Contribute:** find a project in your feed, open it, download the track, upload your amended mix

## Roles

| Taken | Role | Owns | Nov 17 task | Due | First job after Nov 17 | GitHub user |
|---|---|---|---|---|---|---|
| ☐ | Frontend: visual design lead | Visual style, layout on phones, the heuristic evaluation (design is 35% of the grade), Figma mockups | Click through every screen and fix anything that looks off (colors, spacing, wording) in `prototype/index.html`. | Nov 16 night | Turn the current plain screens into a designed app layout | |
| ☐ | Frontend: app logic lead | Routing, project and feed screens, calls to the API (`client/src`) | Click through tasks 2 and 3 as a new user would. Note or fix any dead end or confusing step. | Nov 16 night | Build the project page and feed screen against the agreed API | |
| ☐ | Backend: routes lead | Endpoints for projects, tags, the feed, and contributions (`server/src`) | Click through task 1, including the error messages. Note or fix anything confusing. | Nov 16 night | Project create/read endpoints | Zachary McKinney |
| ☐ | Backend: data lead | Mongoose models, the tag and skill vocabulary, demo seed data (`server/src/models`, `shared/`) | Check the demo content in `prototype/README.md` (skills, genres, moods, sample projects) and change anything a musician would find odd. This list later becomes the `shared/` vocabulary. | Nov 16 night | Project model and the tag/skill list in `shared/` | Zed Suarez |
| ☐ | Floater | Auth, S3 audio storage, Render deployment, AWS access keys, PR review, merging pull requests | Do a dry run with one teammate over Zoom (share screen, hand over control). In class, present the prototype while someone else fills in the findings table. | Dry run Nov 16; session Nov 17 | Review the first `shared/` types PR; hand out AWS keys | |

Out of scope for Nov 17: working code and the profile and "my projects" screens. After Nov 17, the evaluators' findings drive the revision the course requires.

## How the pairs work together

- The Project model and the tag/skill list in `shared/` come first, because the feed and contributions depend on them. Both pairs agree on them before building screens or endpoints.
- Each pair splits its own work. The leads above are starting points, so swap tasks inside the pair whenever that works better.
- Every change goes on a branch and is merged through a pull request that someone other than the author reviews. Rules are in `CLAUDE.md`.

## Still open

- **Stack approval.** The plan in `docs/plans/2026-11-12-001-feat-tech-stack-plan.md` has React + Vite, Express on Render, MongoDB Atlas, and audio in AWS S3. Raise objections before building on it.
- **Video and design write-up.** These go to whoever has the lightest load near the end, likely the floater or the design lead. The video is at most 3 minutes and is 15% of the grade, so start it before the last week.

## Dates

- Nov 17: prototypes due
- Dec 8: final submission (repo, hosted app, video, design write-up)
