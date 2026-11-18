// The tag and skill vocabulary, first drafted by the clickable prototype's demo
// content (prototype/README.md). Single source of truth for client pickers,
// server-side validation, and the Mongoose model enums.
//
// This file is a LEAF: it imports nothing. That constraint is what lets it be
// both the runtime list and the type source without a build step:
//
// - Consumers import values from '@exquisite-chorus/shared/vocabulary'. The
//   package has no compiled output, so the exports map points at this source
//   file. tsx (server dev), vitest, and Vite (client) compile TypeScript
//   directly, and the compiled server on Node 24 loads it through native type
//   stripping: the workspace symlink resolves to a real path outside
//   node_modules, and everything here is erasable syntax (`as const`, types).
//   Leaf-ness matters because Node does not rewrite specifiers, so the file
//   must never import another module.
// - The package root ('.') stays types-only: vocabulary VALUES always come
//   through the './vocabulary' subpath, which keeps the two contracts distinct.
//
// Keep every declaration erasable (no enums, no parameter properties).

/** The two groups the sign-up skill picker shows. */
export const SKILL_CATEGORIES = {
  Instruments: ['Vocals', 'Guitar', 'Bass', 'Drums', 'Keys', 'Synth', 'Strings', 'Brass'],
  Studio: ['Production', 'Mixing', 'Lyrics'],
} as const

/** Every skill, instruments first, in picker order. */
export const SKILLS = [
  ...SKILL_CATEGORIES.Instruments,
  ...SKILL_CATEGORIES.Studio,
] as const

/** What a user can play or do, and what a project can ask for. */
export type Skill = (typeof SKILLS)[number]

/** Project genres. */
export const GENRES = ['Indie', 'Folk', 'Lo-fi', 'Hip-hop', 'R&B', 'Jazz', 'Electronic', 'Rock'] as const

export type Genre = (typeof GENRES)[number]

/** Project moods. */
export const MOODS = ['Mellow', 'Dreamy', 'Upbeat', 'Dark', 'Driving'] as const

export type Mood = (typeof MOODS)[number]

/** The 12 note names, spellings as in the prototype (mixed sharps and flats). */
export const KEY_NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
] as const

/** The two modes a key can be in. */
export const KEY_MODES = ['major', 'minor'] as const

/** All 24 keys as the app displays them: note + mode, e.g. 'G major'. */
export const MUSICAL_KEYS = [
  'C major',
  'C minor',
  'C♯ major',
  'C♯ minor',
  'D major',
  'D minor',
  'E♭ major',
  'E♭ minor',
  'E major',
  'E minor',
  'F major',
  'F minor',
  'F♯ major',
  'F♯ minor',
  'G major',
  'G minor',
  'A♭ major',
  'A♭ minor',
  'A major',
  'A minor',
  'B♭ major',
  'B♭ minor',
  'B major',
  'B minor',
] as const

export type MusicalKey = (typeof MUSICAL_KEYS)[number]
