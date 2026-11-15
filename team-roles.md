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

## Nov 17: prototype for the heuristic evaluation

In class on Nov 17, other groups get mouse control of our clickable prototype over Zoom and evaluate it. The course asks for at least 3 key interactions. A prototype is mockup screens linked together so they can be clicked through, not working code. Build it in one shared Figma file (free, clickable prototypes); any tool the course lists works too.

The three interactions:

1. **Sign up and choose your skills** (instruments, roles)
2. **Start a project:** upload a track, tag it (BPM, key, genre, mood), say what it needs
3. **Contribute:** find a project in your feed, open it, download the track, upload your amended mix

| Role | Task | Done by |
|---|---|---|
| Frontend: visual design lead | Set up the Figma file: colors, type, buttons, form fields, and the app frame with navigation. Then design interaction 3 (feed, project page, contribute). | Style by Nov 15 night; screens Nov 16 |
| Frontend: app logic lead | Design interaction 2 (start a project) using the shared style. | Nov 16 |
| Backend: routes lead | Design interaction 1 (sign up, choose skills) using the shared style. | Nov 16 |
| Backend: data lead | Write the demo content every screen uses: the skill list, tag values, and 6–8 sample projects (title, tags, needs, owner). This list later becomes the `shared/` vocabulary. | Nov 15 night |
| Floater | Link all screens into one click-through. Write a one-page sheet for evaluators: the three tasks to try and Nielsen's 10 heuristics to rate them against. Run a dry run Nov 16 with one teammate, then present and take notes on Nov 17. | Dry run Nov 16; notes Nov 17 |

Out of scope for Nov 17: working code, profile and "my projects" screens, and desktop and phone versions of every screen. Design for desktop, and make one phone version of the feed if there's time. After Nov 17, the evaluators' findings drive the revision the course requires.

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
