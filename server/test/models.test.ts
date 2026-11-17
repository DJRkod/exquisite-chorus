// Model-layer tests: the shared vocabulary, the Project and Contribution
// schemas, user skills, and the demo seed data. Everything runs against the
// in-memory MongoDB from test/setup.ts; seeding is exercised directly through
// seedDatabase() the way the routes will use it.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Skill } from '@exquisite-chorus/shared'
import {
  GENRES,
  KEY_NOTE_NAMES,
  MOODS,
  MUSICAL_KEYS,
  SKILL_CATEGORIES,
  SKILLS,
} from '@exquisite-chorus/shared/vocabulary'
import { createApp } from '../src/app.js'
import { User, toPublicUser } from '../src/auth/user.model.js'
import { loadConfig } from '../src/config.js'
import { Contribution, ORIGINAL_TRACK_NOTE } from '../src/models/contribution.model.js'
import { Project, toProjectDto } from '../src/models/project.model.js'
import { DEMO_PASSWORD, seedDatabase } from '../src/models/seed.js'

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173' })

beforeAll(async () => {
  // Build the unique indexes so duplicate versions hit a real E11000.
  await User.init()
  await Project.init()
  await Contribution.init()
})

describe('shared vocabulary', () => {
  it('has no duplicate skills, genres, moods, or keys', () => {
    expect(new Set(SKILLS).size).toBe(SKILLS.length)
    expect(new Set(GENRES).size).toBe(GENRES.length)
    expect(new Set(MOODS).size).toBe(MOODS.length)
    expect(new Set(MUSICAL_KEYS).size).toBe(MUSICAL_KEYS.length)
  })

  it('lists every skill under exactly one category', () => {
    const categorized = Object.values(SKILL_CATEGORIES).flat()
    expect([...categorized].sort()).toEqual([...SKILLS].sort())
  })

  it('covers all 12 notes in major and minor', () => {
    expect(MUSICAL_KEYS).toHaveLength(KEY_NOTE_NAMES.length * 2)
    for (const note of KEY_NOTE_NAMES) {
      expect(MUSICAL_KEYS).toContain(`${note} major`)
      expect(MUSICAL_KEYS).toContain(`${note} minor`)
    }
    // Spellings the prototype shows on its cards.
    expect(MUSICAL_KEYS).toContain('G major')
    expect(MUSICAL_KEYS).toContain('F♯ minor')
    expect(MUSICAL_KEYS).toContain('E♭ major')
  })
})

describe('Project model', () => {
  function projectInput(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Porch Chords',
      description: 'Fingerpicked acoustic, recorded on my porch.',
      bpm: 92,
      musicalKey: 'G major',
      genre: 'Folk',
      mood: 'Mellow',
      needs: ['Bass', 'Vocals'] as Skill[],
      ...overrides,
    }
  }

  it('saves a fully tagged project with open status and version 1', async () => {
    const owner = await User.create({
      email: 'maya@example.com',
      displayName: 'Maya Okafor',
      passwordHash: 'x',
    })
    const project = await Project.create({ ...projectInput(), owner: owner._id })
    expect(project.status).toBe('open')
    expect(project.currentVersion).toBe(1)
    expect(project.needs).toEqual(['Bass', 'Vocals'])
  })

  it.each([
    ['an unknown genre', { genre: 'Polka' }],
    ['an unknown mood', { mood: 'Wistful' }],
    ['an unknown key', { musicalKey: 'H minor' }],
    ['an out-of-range bpm', { bpm: 401 }],
    ['a non-integer bpm', { bpm: 92.5 }],
    ['an unknown needed skill', { needs: ['Triangle'] }],
    ['no needed skills', { needs: [] }],
    ['a missing title', { title: undefined }],
    ['an over-long title', { title: 'x'.repeat(141) }],
  ])('rejects %s with a validation error', async (_name, overrides) => {
    const owner = await User.create({
      email: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: 'x',
    })
    // Invalid data must be stopped by the schema, not by the compiler.
    await expect(Project.create({ ...projectInput(), owner: owner._id, ...overrides } as never)).rejects.toThrow()
  })

  it('serializes to the client shape with nulls for missing tags', async () => {
    const owner = await User.create({
      email: 'theo@example.com',
      displayName: 'Theo Lindqvist',
      passwordHash: 'x',
    })
    const saved = await Project.create({
      owner: owner._id,
      title: 'Night Bus',
      needs: ['Keys'],
    })
    const dto = toProjectDto(saved, 'Theo Lindqvist')
    expect(dto).toMatchObject({
      ownerId: String(owner._id),
      ownerDisplayName: 'Theo Lindqvist',
      title: 'Night Bus',
      description: null,
      bpm: null,
      musicalKey: null,
      genre: null,
      mood: null,
      needs: ['Keys'],
      status: 'open',
      currentVersion: 1,
    })
    expect(dto.id).toBe(String(saved._id))
    expect(() => new Date(dto.createdAt)).not.toThrow()
  })
})

describe('Contribution model', () => {
  async function projectWithContributor() {
    const owner = await User.create({
      email: 'ana@example.com',
      displayName: 'Ana Ruiz',
      passwordHash: 'x',
    })
    const project = await Project.create({ owner: owner._id, title: 'Copper Wire', needs: ['Vocals'] })
    return { owner, project }
  }

  it('keeps one document per project and version', async () => {
    const { owner, project } = await projectWithContributor()
    await Contribution.create({ project: project._id, contributor: owner._id, version: 1, note: ORIGINAL_TRACK_NOTE })
    await Contribution.create({ project: project._id, contributor: owner._id, version: 2, note: 'Added arp' })

    const again = Contribution.create({ project: project._id, contributor: owner._id, version: 2, note: 'Duplicate' })
    await expect(again).rejects.toMatchObject({ code: 11000 })
  })

  it('rejects version 0 and an over-long note', async () => {
    const { owner, project } = await projectWithContributor()
    await expect(
      Contribution.create({ project: project._id, contributor: owner._id, version: 0 }),
    ).rejects.toThrow()
    await expect(
      Contribution.create({
        project: project._id,
        contributor: owner._id,
        version: 1,
        note: 'x'.repeat(501),
      }),
    ).rejects.toThrow()
  })
})

describe('user skills', () => {
  it('round-trips skills through the public user shape', async () => {
    const user = await User.create({
      email: 'riley@example.com',
      displayName: 'Riley Chen',
      passwordHash: 'x',
      skills: ['Bass', 'Vocals'],
    })
    expect(toPublicUser(user)).toMatchObject({ displayName: 'Riley Chen', skills: ['Bass', 'Vocals'] })
  })

  it('defaults skills to an empty list and rejects unknown skills', async () => {
    const user = await User.create({
      email: 'dev@example.com',
      displayName: 'Dev Patel',
      passwordHash: 'x',
    })
    expect(user.skills).toEqual([])

    await expect(
      User.create({
        email: 'triangle@example.com',
        displayName: 'Triangle Player',
        passwordHash: 'x',
        skills: ['Triangle'],
        // Invalid data must be stopped by the schema, not by the compiler.
      } as never),
    ).rejects.toThrow()
  })
})

describe('sign-up with skills', () => {
  // The same app shape as auth.test.ts: a private route proves the session,
  // and skills ride along on the real sign-up endpoint.
  function makeApp() {
    return createApp(config, { clientDist: null, bcryptRounds: 4 })
  }

  it('stores and returns chosen skills', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({
        email: 'riley@example.com',
        password: 'correct horse',
        displayName: 'Riley Chen',
        skills: ['Bass', 'Vocals'],
      })
    expect(res.status).toBe(201)
    expect(res.body.data.skills).toEqual(['Bass', 'Vocals'])

    const stored = await User.findOne({ email: 'riley@example.com' }).lean()
    expect(stored?.skills).toEqual(['Bass', 'Vocals'])
  })

  it('accepts a sign-up without skills and stores an empty list', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({ email: 'plain@example.com', password: 'correct horse', displayName: 'Plain' })
    expect(res.status).toBe(201)
    expect(res.body.data.skills).toEqual([])
  })

  it('rejects a skill outside the vocabulary and creates no user', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({
        email: 'triangle@example.com',
        password: 'correct horse',
        displayName: 'Triangle Player',
        skills: ['Triangle'],
      })
    expect(res.status).toBe(400)
    expect(await User.countDocuments()).toBe(0)
  })
})

describe('demo seed data', () => {
  const HOUR = 60 * 60 * 1000

  it('inserts the prototype content, matching counts and histories', async () => {
    const fixedNow = new Date('2026-11-17T12:00:00Z').getTime()
    const summary = await seedDatabase(fixedNow)
    expect(summary).toEqual({ users: 12, projects: 7, contributions: 11 })

    const riley = await User.findOne({ email: 'riley@example.com' })
    expect(riley?.skills).toEqual(['Bass', 'Vocals'])

    const porch = await Project.findOne({ title: 'Porch Chords' })
    expect(porch).toMatchObject({
      bpm: 92,
      musicalKey: 'G major',
      genre: 'Folk',
      mood: 'Mellow',
      needs: ['Bass', 'Vocals'],
      currentVersion: 2,
    })

    const history = await Contribution.find({ project: porch!._id }).sort({ version: 1 })
    expect(history.map((c) => [c.version, c.note])).toEqual([
      [1, ORIGINAL_TRACK_NOTE],
      [2, 'Added brushed drums'],
    ])

    const copper = await Project.findOne({ title: 'Copper Wire' })
    expect(copper?.currentVersion).toBe(3)
    // Created with version 1 four days ago; active again five hours ago with v3.
    expect(copper!.createdAt.getTime()).toBe(fixedNow - 96 * HOUR)
    expect(copper!.updatedAt.getTime()).toBe(fixedNow - 5 * HOUR)
    const v3 = await Contribution.findOne({ project: copper!._id, version: 3 })
    expect(v3!.createdAt.getTime()).toBe(fixedNow - 5 * HOUR)
  })

  it('sorts the open-project feed by most recent activity', async () => {
    await seedDatabase()
    // The feed sort the routes will use; _id breaks ties (the recordings
    // list convention), e.g. Porch Chords v2 and Basement Waltz are both
    // two days old.
    const feed = await Project.find({ status: 'open' }).sort({ updatedAt: -1, _id: -1 })
    expect(feed.map((p) => p.title)).toEqual([
      'Copper Wire', // 5 hours ago
      'Static Garden', // 12 hours ago
      'Night Bus', // 1 day ago
      'Basement Waltz', // 2 days ago (later id than Porch Chords)
      'Porch Chords', // 2 days ago (its latest version)
      'Low Tide', // 4 days ago (its latest version)
      'Second Wind', // 1 week ago
    ])
  })

  it('is idempotent: running it twice changes nothing', async () => {
    await seedDatabase()
    const again = await seedDatabase()
    expect(again).toEqual({ users: 12, projects: 7, contributions: 11 })
    expect(await User.countDocuments()).toBe(12)
    expect(await Project.countDocuments()).toBe(7)
    expect(await Contribution.countDocuments()).toBe(11)
  })

  it('gives every demo account the shared demo password', async () => {
    await seedDatabase()
    const maya = await User.findOne({ email: 'maya@example.com' })
    const { default: bcrypt } = await import('bcryptjs')
    expect(await bcrypt.compare(DEMO_PASSWORD, maya!.passwordHash)).toBe(true)
  })
})
