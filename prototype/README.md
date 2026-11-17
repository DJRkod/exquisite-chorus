# Clickable prototype (Nov 17)

A click-through mockup of three key interactions, used for the heuristic evaluation in class. It is one HTML file that runs on its own and is separate from the app in `client/`.

**To open it,** double-click `index.html` or drag it into a browser. The evaluator's sheet is in [`docs/heuristic-evaluation.md`](../docs/heuristic-evaluation.md).

## What it covers

1. **Sign up and choose your skills:** welcome page, account form with validation, skill picker.
2. **Start a project:** upload a track, add tags (BPM, key, genre, mood), choose what it needs, review, publish.
3. **Contribute:** feed matched to your skills with genre filters, project page with player and version history, download the current mix, upload your amended mix.

The **Prototype tasks** button (bottom right on larger screens, above the page content on smaller screens) resets the prototype and jumps to the start of any task. If you open the feed directly, you are signed in as Riley Chen, who plays bass and sings.

## What is simulated

- Nothing is saved. Reloading the page starts over.
- No audio plays. The play button moves the progress bar only.
- "Choose an audio file" picks a sample file. Download shows a message and saves nothing.
- Sign in, My projects, and the profile menu show a "not part of this prototype" message.

## Demo content

The demo content is a first draft of the skill and tag lists in `shared/`.

- **Skills.** Instruments: Vocals, Guitar, Bass, Drums, Keys, Synth, Strings, Brass. Studio: Production, Mixing, Lyrics.
- **Genres:** Indie, Folk, Lo-fi, Hip-hop, R&B, Jazz, Electronic, Rock.
- **Moods:** Mellow, Dreamy, Upbeat, Dark, Driving.
- **Keys:** the 12 notes, each major or minor.

| Project | Owner | Tags | Needs | Versions |
|---|---|---|---|---|
| Porch Chords | Maya Okafor | 92 BPM, G major, Folk, Mellow | Bass, Vocals | 2 |
| Night Bus | Theo Lindqvist | 84 BPM, F♯ minor, Lo-fi, Dreamy | Keys, Drums | 1 |
| Copper Wire | Ana Ruiz | 128 BPM, A minor, Electronic, Driving | Vocals, Lyrics | 3 |
| Basement Waltz | Jules Park | 104 BPM, D minor, Jazz, Dark | Brass, Bass | 1 |
| Low Tide | Sam Adeyemi | 70 BPM, E♭ major, R&B, Mellow | Guitar, Vocals | 2 |
| Static Garden | Priya Nair | 140 BPM, C minor, Hip-hop, Dark | Lyrics, Vocals | 1 |
| Second Wind | Leo Brandt | 156 BPM, E major, Rock, Upbeat | Drums, Bass | 1 |

The people and projects are made up.

## Look

- **Colors:** Illinois Blue (#13294B) for the top bar and text, and Illinois Orange (#FF5F05) for the main action on each screen. Orange buttons use blue text, because white text on that orange fails the contrast check.
- **Fonts (Google Fonts):** Bricolage Grotesque for headings, Instrument Sans for body text, DM Mono for data such as "92 BPM · G major". None of them has ♯ or ♭, so those two signs come from a system symbol font.
- **Icons:** from the Noun Project, licensed CC BY 3.0, which requires crediting each creator. The instrument icons are by Eucalyp, and the play, pause and check icons are by Meko. The page shows the credits under "Icon credits" at the bottom, and [`icons/credits.json`](icons/credits.json) lists each icon's link. The PNGs in `icons/` are 128px copies of the Noun Project previews, and the page embeds them so it still works as a single file. No image or sound in the prototype is AI-generated.

## Changing it

The page is plain HTML, CSS, and JavaScript with no build step. The demo content is at the top of the script (`seedProjects`), and each screen is a function in `screens`. Check the change by clicking through all three tasks.
