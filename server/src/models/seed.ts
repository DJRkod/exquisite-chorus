// Inserts the demo content from the clickable prototype (prototype/README.md)
// so the app has something to show before real users arrive: the same people,
// projects, tags, needs, and version histories the heuristic evaluators saw.
//
// Run from the repo root:
//   npm run seed                     # against MONGODB_URI (.env), e.g. Atlas or local MongoDB
//   npm run seed -- --in-memory      # no MongoDB needed: a throwaway in-memory database
//
// Seeding is idempotent: it first removes the demo users and everything they
// own, then re-creates it, so the script can run twice. It never touches
// accounts that are not part of the demo.
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Skill } from '@exquisite-chorus/shared'
import { GENRES, MOODS, MUSICAL_KEYS, SKILLS } from '@exquisite-chorus/shared/vocabulary'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { loadConfig } from '../config.js'
import { User } from '../auth/user.model.js'
import { connectDb, disconnectDb } from '../db.js'
import { Contribution, ORIGINAL_TRACK_NOTE } from './contribution.model.js'
import { Project } from './project.model.js'

/** Every demo account signs in with this password. */
export const DEMO_PASSWORD = 'chorus-demo-2026'

const HOUR = 60 * 60 * 1000

export interface SeedSummary {
  users: number
  projects: number
  contributions: number
}

interface SeedUser {
  name: string
  email: string
  skills: Skill[]
}

/** The prototype's people, plus the demo account the feed is signed in as. */
const SEED_USERS: SeedUser[] = [
  { name: 'Riley Chen', email: 'riley@example.com', skills: ['Bass', 'Vocals'] },
  { name: 'Maya Okafor', email: 'maya@example.com', skills: ['Guitar', 'Vocals'] },
  { name: 'Theo Lindqvist', email: 'theo@example.com', skills: ['Guitar', 'Synth'] },
  { name: 'Ana Ruiz', email: 'ana@example.com', skills: ['Production', 'Synth'] },
  { name: 'Jules Park', email: 'jules@example.com', skills: ['Keys', 'Production'] },
  { name: 'Sam Adeyemi', email: 'sam@example.com', skills: ['Drums', 'Production'] },
  { name: 'Priya Nair', email: 'priya@example.com', skills: ['Production', 'Lyrics'] },
  { name: 'Leo Brandt', email: 'leo@example.com', skills: ['Guitar', 'Vocals'] },
  { name: 'Dev Patel', email: 'dev@example.com', skills: ['Drums'] },
  { name: 'Kai Mendes', email: 'kai@example.com', skills: ['Bass', 'Synth'] },
  { name: 'Lena Fox', email: 'lena@example.com', skills: ['Synth', 'Production'] },
  { name: 'Noor Haddad', email: 'noor@example.com', skills: ['Keys', 'Synth'] },
]

interface SeedProject {
  title: string
  owner: string
  /** Hours ago the original track (version 1) was uploaded. */
  createdHoursAgo: number
  description: string
  bpm: number
  musicalKey: string
  genre: string
  mood: string
  needs: Skill[]
}

/** The prototype's seven projects, tags and all. */
const SEED_PROJECTS: SeedProject[] = [
  {
    title: 'Porch Chords',
    owner: 'maya@example.com',
    createdHoursAgo: 72,
    description: 'Fingerpicked acoustic, recorded on my porch. It wants a walking bass line and a soft lead vocal, no lyrics yet so go wild.',
    bpm: 92,
    musicalKey: 'G major',
    genre: 'Folk',
    mood: 'Mellow',
    needs: ['Bass', 'Vocals'],
  },
  {
    title: 'Night Bus',
    owner: 'theo@example.com',
    createdHoursAgo: 24,
    description: 'Tape-warped guitar loop. Looking for Rhodes chords and a lazy beat.',
    bpm: 84,
    musicalKey: 'F♯ minor',
    genre: 'Lo-fi',
    mood: 'Dreamy',
    needs: ['Keys', 'Drums'],
  },
  {
    title: 'Copper Wire',
    owner: 'ana@example.com',
    createdHoursAgo: 96,
    description: 'Full instrumental is done. Needs a topline and words about leaving a city.',
    bpm: 128,
    musicalKey: 'A minor',
    genre: 'Electronic',
    mood: 'Driving',
    needs: ['Vocals', 'Lyrics'],
  },
  {
    title: 'Basement Waltz',
    owner: 'jules@example.com',
    createdHoursAgo: 48,
    description: 'Piano trio sketch in 3/4. A muted trumpet melody would make it.',
    bpm: 104,
    musicalKey: 'D minor',
    genre: 'Jazz',
    mood: 'Dark',
    needs: ['Brass', 'Bass'],
  },
  {
    title: 'Low Tide',
    owner: 'sam@example.com',
    createdHoursAgo: 144,
    description: 'Slow jam with a drum machine and pads. Clean guitar fills and harmonies wanted.',
    bpm: 70,
    musicalKey: 'E♭ major',
    genre: 'R&B',
    mood: 'Mellow',
    needs: ['Guitar', 'Vocals'],
  },
  {
    title: 'Static Garden',
    owner: 'priya@example.com',
    createdHoursAgo: 12,
    description: 'Beat is finished. Looking for a verse, 16 bars.',
    bpm: 140,
    musicalKey: 'C minor',
    genre: 'Hip-hop',
    mood: 'Dark',
    needs: ['Lyrics', 'Vocals'],
  },
  {
    title: 'Second Wind',
    owner: 'leo@example.com',
    createdHoursAgo: 168,
    description: 'Two guitars and a scratch vocal. Needs a real rhythm section.',
    bpm: 156,
    musicalKey: 'E major',
    genre: 'Rock',
    mood: 'Upbeat',
    needs: ['Drums', 'Bass'],
  },
]

interface SeedContribution {
  project: string
  contributor: string
  version: number
  note: string
  /** Hours ago this version was submitted. */
  hoursAgo: number
}

/** The prototype's version histories; version 1 is always the original track. */
const SEED_CONTRIBUTIONS: SeedContribution[] = [
  { project: 'Porch Chords', contributor: 'maya@example.com', version: 1, note: ORIGINAL_TRACK_NOTE, hoursAgo: 72 },
  { project: 'Porch Chords', contributor: 'dev@example.com', version: 2, note: 'Added brushed drums', hoursAgo: 48 },
  { project: 'Night Bus', contributor: 'theo@example.com', version: 1, note: ORIGINAL_TRACK_NOTE, hoursAgo: 24 },
  { project: 'Copper Wire', contributor: 'ana@example.com', version: 1, note: ORIGINAL_TRACK_NOTE, hoursAgo: 96 },
  { project: 'Copper Wire', contributor: 'lena@example.com', version: 2, note: 'Added arp', hoursAgo: 48 },
  { project: 'Copper Wire', contributor: 'kai@example.com', version: 3, note: 'New synth bass', hoursAgo: 5 },
  { project: 'Basement Waltz', contributor: 'jules@example.com', version: 1, note: ORIGINAL_TRACK_NOTE, hoursAgo: 48 },
  { project: 'Low Tide', contributor: 'sam@example.com', version: 1, note: ORIGINAL_TRACK_NOTE, hoursAgo: 144 },
  { project: 'Low Tide', contributor: 'noor@example.com', version: 2, note: 'Added pads', hoursAgo: 96 },
  { project: 'Static Garden', contributor: 'priya@example.com', version: 1, note: ORIGINAL_TRACK_NOTE, hoursAgo: 12 },
  { project: 'Second Wind', contributor: 'leo@example.com', version: 1, note: ORIGINAL_TRACK_NOTE, hoursAgo: 168 },
]

/** True when the seed data's vocabulary values are all still known. */
function validateVocabulary(): void {
  const skills = SKILLS as readonly string[]
  for (const user of SEED_USERS) {
    for (const skill of user.skills) {
      if (!skills.includes(skill)) throw new Error(`Unknown skill in seed data: ${skill}`)
    }
  }
  const genres = GENRES as readonly string[]
  const moods = MOODS as readonly string[]
  const keys = MUSICAL_KEYS as readonly string[]
  for (const project of SEED_PROJECTS) {
    if (!genres.includes(project.genre)) throw new Error(`Unknown genre in seed data: ${project.genre}`)
    if (!moods.includes(project.mood)) throw new Error(`Unknown mood in seed data: ${project.mood}`)
    if (!keys.includes(project.musicalKey)) throw new Error(`Unknown key in seed data: ${project.musicalKey}`)
    for (const need of project.needs) {
      if (!skills.includes(need)) throw new Error(`Unknown needed skill in seed data: ${need}`)
    }
  }
}

/** Removes the demo users and everything they own, then inserts fresh demo data. */
export async function seedDatabase(now = Date.now()): Promise<SeedSummary> {
  validateVocabulary()

  const emails = SEED_USERS.map((user) => user.email)
  const previous = await User.find({ email: { $in: emails } }).select({ _id: 1 }).lean()
  const previousIds = previous.map((user) => user._id)
  if (previousIds.length > 0) {
    const ownedProjects = await Project.find({ owner: { $in: previousIds } }).select({ _id: 1 }).lean()
    await Contribution.deleteMany({
      $or: [{ contributor: { $in: previousIds } }, { project: { $in: ownedProjects.map((p) => p._id) } }],
    })
    await Project.deleteMany({ owner: { $in: previousIds } })
    await User.deleteMany({ _id: { $in: previousIds } })
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)
  const users = await User.create(
    SEED_USERS.map(({ name, email, skills }) => ({ email, displayName: name, skills, passwordHash })),
  )
  const idByEmail = new Map(users.map((user) => [user.email, user._id]))

  const latestVersionByTitle = new Map<string, number>()
  const latestHoursAgoByTitle = new Map<string, number>()
  for (const contribution of SEED_CONTRIBUTIONS) {
    latestVersionByTitle.set(
      contribution.project,
      Math.max(latestVersionByTitle.get(contribution.project) ?? 0, contribution.version),
    )
    const existing = latestHoursAgoByTitle.get(contribution.project)
    if (existing === undefined || contribution.hoursAgo < existing) {
      latestHoursAgoByTitle.set(contribution.project, contribution.hoursAgo)
    }
  }

  const projects = await Project.create(
    SEED_PROJECTS.map((project) => ({
      owner: idByEmail.get(project.owner),
      title: project.title,
      description: project.description,
      bpm: project.bpm,
      musicalKey: project.musicalKey,
      genre: project.genre,
      mood: project.mood,
      needs: project.needs,
      currentVersion: latestVersionByTitle.get(project.title) ?? 1,
      createdAt: new Date(now - project.createdHoursAgo * HOUR),
    })),
  )
  const idByTitle = new Map(projects.map((project) => [project.title, project._id]))

  // Mongoose takes createdAt from the payload but resets updatedAt on insert,
  // so the activity time (the last contribution, which the feed sorts on) is
  // written in a second pass with the automatic timestamp disabled.
  await Promise.all(
    SEED_PROJECTS.map((project) => {
      const hoursAgo = latestHoursAgoByTitle.get(project.title) ?? project.createdHoursAgo
      return Project.updateOne(
        { _id: idByTitle.get(project.title) },
        { updatedAt: new Date(now - hoursAgo * HOUR) },
        { timestamps: false },
      )
    }),
  )

  await Contribution.create(
    SEED_CONTRIBUTIONS.map((contribution) => ({
      project: idByTitle.get(contribution.project),
      contributor: idByEmail.get(contribution.contributor),
      version: contribution.version,
      note: contribution.note,
      createdAt: new Date(now - contribution.hoursAgo * HOUR),
    })),
  )

  return { users: users.length, projects: projects.length, contributions: SEED_CONTRIBUTIONS.length }
}

function printSummary(summary: SeedSummary): void {
  console.log(`Seeded ${summary.users} demo users, ${summary.projects} projects, ${summary.contributions} contributions.`)
  console.log(`Demo sign-in: any of ${SEED_USERS.map((user) => user.email).join(', ')}`)
  console.log(`Password for every demo account: ${DEMO_PASSWORD}`)
}

async function main(): Promise<void> {
  const inMemory = process.argv.includes('--in-memory')
  let mongod: MongoMemoryServer | undefined
  try {
    let uri: string
    if (inMemory) {
      mongod = await MongoMemoryServer.create()
      uri = mongod.getUri('exquisite-chorus')
      console.log('Using a throwaway in-memory MongoDB (nothing is saved after the script exits).')
    } else {
      // The repo-root .env, resolved like server/src/index.ts does it.
      dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })
      uri = loadConfig(process.env).mongodbUri
    }
    await connectDb(uri)
    printSummary(await seedDatabase())
  } catch (err) {
    console.error('Seeding failed:', err instanceof Error ? err.message : err)
    console.error('No MongoDB reachable? Try:  npm run seed -- --in-memory')
    process.exitCode = 1
  } finally {
    await disconnectDb()
    await mongod?.stop()
  }
}

// Run as a script (tsx src/models/seed.ts or node dist/models/seed.js), not on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
