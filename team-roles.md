# Team roles: sign-up sheet

Five people split into a frontend pair, a backend pair, and a floater. Each area has two people who know it, so the work keeps moving when someone is sick or busy. To claim a role, write your name next to it.

## Roles

| Role | Owns | First job | Name |
|---|---|---|---|
| Frontend: visual design lead | Visual style, layout on phones, the heuristic evaluation (design is 35% of the grade), Figma mockups | Turn the skeleton's plain screens into a designed app layout | |
| Frontend: app logic lead | Routing, project and feed screens, calls to the API (`client/src`) | Build the project page and feed screen against the agreed API | |
| Backend: routes lead | Endpoints for projects, tags, the feed, and contributions (`server/src`) | Project create/read endpoints | |
| Backend: data lead | Mongoose models, the tag and skill vocabulary, demo seed data (`server/src/models`, `shared/`) | Project model and the tag/skill list in `shared/` | |
| Floater | Auth, S3 audio storage, Render deployment, AWS access keys, PR review, merging the pieces together | Review the first `shared/` types PR; hand out AWS keys | |

## How the pairs work together

- The Project model and the tag/skill list in `shared/` come first, because the feed and contributions depend on them. Both pairs agree on them before building screens or endpoints.
- Each pair splits its own work. The leads above are starting points, so swap tasks inside the pair whenever that works better.
- Every change goes on a branch and goes in through a pull request that someone outside the author reviews. Rules are in `CLAUDE.md`.

## Still open

- **Stack approval.** The plan in `docs/plans/2026-11-12-001-feat-tech-stack-plan.md` has React + Vite, Express on Render, MongoDB Atlas, and audio in AWS S3. Raise objections before building on it.
- **Video and design write-up.** These go to whoever has the lightest load near the end, likely the floater or the design lead. The video is at most 3 minutes and is 15% of the grade, so start it before the last week.

## Dates

- Nov 17: prototypes due
- Dec 8: final submission (repo, hosted app, video, design write-up)
