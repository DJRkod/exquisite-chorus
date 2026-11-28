import { randomUUID } from 'node:crypto'
import { GENRES, MOODS, MUSICAL_KEYS, SKILLS } from '@exquisite-chorus/shared/vocabulary'
import session from 'express-session'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { User } from '../src/auth/user.model.js'
import { loadConfig } from '../src/config.js'
import { Contribution, ORIGINAL_TRACK_NOTE } from '../src/models/contribution.model.js'
import { Project } from '../src/models/project.model.js'
import { Recording } from '../src/recordings/recording.model.js'

// The signup limiter is intentionally scoped per Express app (10 attempts
// per 15 minutes). Create a fresh app for each test so independent tests
// don't exhaust each other's rate-limit quota.
let app: ReturnType<typeof createApp>
beforeEach(() => {
  app = createApp(loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173' }), {
    clientDist: null,
    bcryptRounds: 4,
    // These API tests verify auth cookies, not MongoDB session persistence.
    sessionStore: new session.MemoryStore(),
  })
})

const alice = {
  email: 'alice@example.com',
  password: 'correct horse',
  displayName: 'Alice',
  skills: ['Bass', 'Vocals'],
}

async function signedIn(profile = alice) {
  const agent = request.agent(app)
  await agent.post('/api/auth/signup').send(profile).expect(201)
  return agent
}

const validProject = {
  title: '  Indie Guitar Riff  ',
  description: 'Need drums and bass!',
  bpm: 120,
  musicalKey: 'G major',
  genre: 'Indie',
  mood: 'Upbeat',
  needs: ['Drums', 'Bass', 'Bass'],
}

beforeAll(async () => {
  await User.init()
  await Project.init()
  await Contribution.init()
  await Recording.init()
})

describe('POST /api/projects', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/projects').send(validProject)
    expect(res.status).toBe(401)
    expect(await Project.countDocuments()).toBe(0)
  })

  it('creates an owned project and its original version', async () => {
    const agent = await signedIn()
    const res = await agent.post('/api/projects').send(validProject)
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      message: 'Project created',
      data: {
        title: 'Indie Guitar Riff',
        ownerDisplayName: 'Alice',
        status: 'open',
        currentVersion: 1,
        needs: ['Drums', 'Bass'],
        bpm: 120,
        genre: 'Indie',
      },
    })
    const user = await User.findOne({ email: alice.email })
    expect(res.body.data.ownerId).toBe(String(user!._id))
    const saved = await Project.findById(res.body.data.id)
    expect(saved?.owner.toString()).toBe(String(user!._id))
    const versions = await Contribution.find({ project: saved!._id })
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 1, note: ORIGINAL_TRACK_NOTE })
    expect(versions[0].contributor.toString()).toBe(String(user!._id))
  })

  it('accepts projects without optional tags and rejects owner spoofing', async () => {
    const agent = await signedIn()
    const res = await agent.post('/api/projects').send({
      title: 'Minimal Idea',
      needs: ['Keys'],
      owner: '000000000000000000000000',
      status: 'closed',
      currentVersion: 999,
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      title: 'Minimal Idea',
      status: 'open',
      currentVersion: 1,
      description: null,
      bpm: null,
      musicalKey: null,
    })
    expect(res.body.data.ownerId).not.toBe('000000000000000000000000')
  })

  it.each([
    ['missing title', { ...validProject, title: '   ' }],
    ['oversized title', { ...validProject, title: 'x'.repeat(141) }],
    ['missing needs', { ...validProject, needs: undefined }],
    ['empty needs', { ...validProject, needs: [] }],
    ['unknown skills', { ...validProject, needs: ['Triangle'] }],
    ['invalid BPM', { ...validProject, bpm: 120.5 }],
    ['BPM out of range', { ...validProject, bpm: 401 }],
    ['unknown genre', { ...validProject, genre: 'Polka' }],
    ['invalid description', { ...validProject, description: 123 }],
  ])('rejects %s with 400', async (_label, body) => {
    const agent = await signedIn()
    const res = await agent.post('/api/projects').send(body)
    expect(res.status).toBe(400)
    expect(res.body.data).toBeNull()
    expect(await Project.countDocuments()).toBe(0)
  })
})

describe('GET /api/projects', () => {
  it('requires auth and lists open projects with owner names', async () => {
    const agent = await signedIn()
    const user = await User.findOne({ email: alice.email })
    await Project.create({ owner: user!._id, title: 'Open', needs: ['Bass'] })
    await Project.create({ owner: user!._id, title: 'Closed', needs: ['Bass'], status: 'closed' })
    await request(app).get('/api/projects').expect(401)
    const res = await agent.get('/api/projects')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({ title: 'Open', ownerDisplayName: 'Alice' })
  })

  it('matched=true returns projects requiring the user skills, excluding their own', async () => {
    const agent = await signedIn()
    const other = await User.create({ email: 'other@example.com', displayName: 'Other', passwordHash: 'unused' })
    const me = await User.findOne({ email: alice.email })
    await Project.create({ owner: other._id, title: 'Bass wanted', needs: ['Bass'] })
    await Project.create({ owner: other._id, title: 'Drummer wanted', needs: ['Drums'] })
    await Project.create({ owner: me!._id, title: 'My bass project', needs: ['Bass'] })
    const res = await agent.get('/api/projects?matched=true')
    expect(res.status).toBe(200)
    expect(res.body.data.map((p: {title:string}) => p.title)).toEqual(['Bass wanted'])
  })

  it('mine=true includes closed projects, and invalid flags return 400', async () => {
    const agent = await signedIn()
    const me = await User.findOne({ email: alice.email })
    await Project.create({ owner: me!._id, title: 'Closed', needs: ['Bass'], status: 'closed' })
    expect((await agent.get('/api/projects?mine=true')).body.data).toHaveLength(1)
    await agent.get('/api/projects?matched=maybe').expect(400)
    await agent.get('/api/projects?mine=true&matched=true').expect(400)
  })
})

describe('GET /api/projects/:id', () => {
  it('returns project metadata or useful 400 and 404 errors', async () => {
    const agent = await signedIn()
    const user = await User.findOne({ email: alice.email })
    const project = await Project.create({ owner: user!._id, title: 'Detail', needs: ['Vocals'] })
    await request(app).get(`/api/projects/${project._id}`).expect(401)
    const found = await agent.get(`/api/projects/${project._id}`)
    expect(found.status).toBe(200)
    expect(found.body.data).toMatchObject({ title: 'Detail', ownerDisplayName: 'Alice' })
    await agent.get('/api/projects/not-an-id').expect(400)
    await agent.get('/api/projects/000000000000000000000000').expect(404)
  })
})

const bob = { ...alice, email: 'bob@example.com', displayName: 'Bob', skills: ['Drums'] }

// Confirmed-recording fixtures keep these tests local; the recording API's
// separate suite covers the S3 upload/confirmation steps.
async function recordingFor(email: string, status: 'ready' | 'pending' = 'ready') {
  const user = await User.findOne({ email }).orFail()
  const uuid = randomUUID()
  return Recording.create({
    owner: user._id,
    status,
    pendingKey: `pending/${user._id}/${uuid}`,
    ...(status === 'ready' ? { key: `audio/${user._id}/${uuid}` } : {}),
    contentType: 'audio/wav',
  })
}

describe('original audio attachment', () => {
  it('attaches a confirmed recording to version 1 and prevents reuse', async () => {
    const agent = await signedIn()
    const rec = await recordingFor(alice.email)
    const res = await agent.post('/api/projects').send({ ...validProject, recordingId: rec.id }).expect(201)
    const id = res.body.data.id as string
    const history = await agent.get(`/api/projects/${id}/contributions`).expect(200)
    expect(history.body.data).toHaveLength(1)
    expect(history.body.data[0]).toMatchObject({ version: 1, parentVersion: null, approved: false, skillsAdded: [], recordingId: rec.id, contributorDisplayName: 'Alice' })
    expect(history.body.data[0]).not.toHaveProperty('key')
    expect(String((await Recording.findById(rec.id))?.project)).toBe(id)
    await agent.post('/api/projects').send({ ...validProject, recordingId: rec.id }).expect(409)
    expect(await Project.countDocuments()).toBe(1)
  })

  it('rejects malformed, missing, foreign and unconfirmed recordings', async () => {
    const agent = await signedIn()
    await signedIn(bob)
    const foreign = await recordingFor(bob.email)
    const pending = await recordingFor(alice.email, 'pending')
    await agent.post('/api/projects').send({ ...validProject, recordingId: 'bad' }).expect(400)
    await agent.post('/api/projects').send({ ...validProject, recordingId: '000000000000000000000000' }).expect(404)
    await agent.post('/api/projects').send({ ...validProject, recordingId: foreign.id }).expect(404)
    await agent.post('/api/projects').send({ ...validProject, recordingId: pending.id }).expect(409)
    expect(await Project.countDocuments()).toBe(0)
    expect(await Contribution.countDocuments()).toBe(0)
  })
})

describe('project contributions', () => {
  it('publishes the next mix and updates requested skills and history', async () => {
    const owner = await signedIn()
    const contributor = await signedIn(bob)
    const original = await recordingFor(alice.email)
    const project = await owner.post('/api/projects').send({ ...validProject, recordingId: original.id }).expect(201)
    const id = project.body.data.id as string
    const path = `/api/projects/${id}/contributions`
    const mix = await recordingFor(bob.email)
    const submitted = await contributor.post(path).send({ recordingId: mix.id, note: ' Added drums ', baseVersion: 1, needs: ['Vocals'] }).expect(201)
    expect(submitted.body.data).toMatchObject({ version: 2, recordingId: mix.id, note: 'Added drums', contributorDisplayName: 'Bob' })
    expect((await owner.get(`/api/projects/${id}`).expect(200)).body.data).toMatchObject({ currentVersion: 2, needs: ['Vocals'] })
    const history = await owner.get(path).expect(200)
    expect(history.body.data.map((v: {version: number}) => v.version)).toEqual([2, 1])
    expect(history.body.data.map((v: {recordingId: string}) => v.recordingId)).toEqual([mix.id, original.id])
    expect(String((await Recording.findById(mix.id))?.project)).toBe(id)
    await contributor.post(path).send({ recordingId: mix.id, baseVersion: 2 }).expect(409)
    await contributor.post(path).send({ note: 'Missing parent', baseVersion: 99 }).expect(404)
    expect(await Contribution.countDocuments()).toBe(2)
  })

  it('supports note-only contributions and preserves needs if omitted', async () => {
    const agent = await signedIn()
    const project = await agent.post('/api/projects').send(validProject).expect(201)
    const id = project.body.data.id as string
    const res = await agent.post(`/api/projects/${id}/contributions`).send({ note: 'New lyric idea', baseVersion: 1 }).expect(201)
    expect(res.body.data).toMatchObject({ version: 2, recordingId: null })
    expect((await agent.get(`/api/projects/${id}`).expect(200)).body.data.needs).toEqual(['Drums', 'Bass'])
  })

  it('checks auth, input, ownership, upload status and closed projects', async () => {
    const owner = await signedIn()
    const contributor = await signedIn(bob)
    const project = await owner.post('/api/projects').send(validProject).expect(201)
    const id = project.body.data.id as string
    const path = `/api/projects/${id}/contributions`
    const foreign = await recordingFor(alice.email)
    const pending = await recordingFor(bob.email, 'pending')
    await request(app).get(path).expect(401)
    await request(app).post(path).send({ note: 'Hello' }).expect(401)
    await contributor.post(path).send({ note: '  ' }).expect(400)
    await contributor.post(path).send({ note: 'x'.repeat(501) }).expect(400)
    await contributor.post(path).send({ note: 'Lyrics', baseVersion: 0 }).expect(400)
    await contributor.post(path).send({ note: 'Lyrics', needs: ['Triangle'] }).expect(400)
    await contributor.post(path).send({ recordingId: foreign.id }).expect(404)
    await contributor.post(path).send({ recordingId: pending.id }).expect(409)
    await contributor.get('/api/projects/bad/contributions').expect(400)
    await contributor.get('/api/projects/000000000000000000000000/contributions').expect(404)
    await contributor.post('/api/projects/000000000000000000000000/contributions').send({ note: 'Hello' }).expect(404)
    await Project.updateOne({ _id: id }, { status: 'closed' })
    await contributor.post(path).send({ note: 'Lyrics' }).expect(409)
    expect(await Contribution.countDocuments()).toBe(1)
  })

  it('keeps version numbers unique for simultaneous branches and permits a conflicted submission to retry', async () => {
    const owner = await signedIn()
    const contributor = await signedIn(bob)
    const project = await owner.post('/api/projects').send(validProject).expect(201)
    const id = project.body.data.id as string
    const path = `/api/projects/${id}/contributions`
    const a = await recordingFor(bob.email)
    const b = await recordingFor(bob.email)
    const results = await Promise.all([
      contributor.post(path).send({ recordingId: a.id, baseVersion: 1 }),
      contributor.post(path).send({ recordingId: b.id, baseVersion: 1 }),
    ])
    // Either both requests serialize successfully or one sees a version-number
    // conflict. A retry still branches from v1, rather than changing its parent.
    expect(results.map((r) => r.status)).toContain(201)
    const recordings = [a, b]
    for (const [index, result] of results.entries()) {
      if (result.status === 409) {
        await contributor.post(path).send({ recordingId: recordings[index].id, baseVersion: 1 }).expect(201)
      } else {
        expect(result.status).toBe(201)
      }
    }
    expect((await Project.findById(id))?.currentVersion).toBe(3)
    const versions = await Contribution.find({ project: id }).sort({ version: 1 }).lean()
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(versions.slice(1).map((v) => v.parentVersion)).toEqual([1, 1])
    expect(await Recording.countDocuments({ project: id })).toBe(2)
  })
})


describe('GET /api/tags', () => {
  it('returns the shared picker options without requiring a session', async () => {
    const res = await request(app).get('/api/tags').expect(200)
    expect(res.body.data).toEqual({ skills: [...SKILLS], genres: [...GENRES], moods: [...MOODS], musicalKeys: [...MUSICAL_KEYS], bpmMin: 20, bpmMax: 400 })
  })
})

describe('project tag filters', () => {
  it('combines exact tags, BPM and requested skill', async () => {
    const agent = await signedIn()
    const owner = await User.findOne({ email: alice.email }).orFail()
    const base = { owner: owner._id, needs: ['Bass' as const], genre: 'Rock' as const, mood: 'Driving' as const, musicalKey: 'G major' as const, bpm: 120 }
    await Project.create({ ...base, title: 'Match' }, { ...base, title: 'Wrong genre', genre: 'Indie' }, { ...base, title: 'Wrong BPM', bpm: 130 }, { ...base, title: 'Closed', status: 'closed' }, { ...base, title: 'Wrong skill', needs: ['Drums'] }, { ...base, title: 'Wrong mood', mood: 'Dreamy' }, { ...base, title: 'Wrong key', musicalKey: 'C major' })
    const res = await agent.get('/api/projects').query({ genre: 'Rock', mood: 'Driving', musicalKey: 'G major', bpm: '120', need: 'Bass' }).expect(200)
    expect(res.body.data.map((p: {title: string}) => p.title)).toEqual(['Match'])
  })

  it('preserves skill matching when another requested skill is selected', async () => {
    const agent = await signedIn()
    const other = await User.create({ email: 'filter@example.com', displayName: 'Other', passwordHash: 'unused' })
    await Project.create({ owner: other._id, title: 'Both', needs: ['Bass', 'Drums'] }, { owner: other._id, title: 'Only drums', needs: ['Drums'] }, { owner: other._id, title: 'Only bass', needs: ['Bass'] })
    const res = await agent.get('/api/projects?matched=true&need=Drums').expect(200)
    expect(res.body.data.map((p: {title: string}) => p.title)).toEqual(['Both'])
  })

  it('rejects invalid or repeated filters', async () => {
    const agent = await signedIn()
    for (const query of ['genre=Polka', 'mood=unknown', 'musicalKey=H', 'need=Triangle', 'bpm=120.5', 'bpm=401', 'genre=Rock&genre=Indie', 'need=Bass&need=Drums']) {
      await agent.get(`/api/projects?${query}`).expect(400)
    }
  })
})

describe('PATCH /api/projects/:id', () => {
  it('edits owned metadata, clears optional tags and preserves versions', async () => {
    const agent = await signedIn()
    const created = await agent.post('/api/projects').send(validProject).expect(201)
    const id = created.body.data.id as string
    const res = await agent.patch(`/api/projects/${id}`).send({ title: ' New title ', genre: null, bpm: null, needs: ['Keys', 'Keys'] }).expect(200)
    expect(res.body.data).toMatchObject({ title: 'New title', genre: null, bpm: null, needs: ['Keys'], currentVersion: 1, ownerId: created.body.data.ownerId, description: validProject.description })
    expect((await Project.findById(id))?.genre).toBeUndefined()
    expect(await Contribution.countDocuments({ project: id })).toBe(1)
  })

  it('requires authentication and ownership', async () => {
    const owner = await signedIn()
    const other = await signedIn(bob)
    const created = await owner.post('/api/projects').send(validProject).expect(201)
    const path = `/api/projects/${created.body.data.id}`
    await request(app).patch(path).send({ title: 'Changed' }).expect(401)
    await other.patch(path).send({ title: 'Changed' }).expect(403)
    await owner.patch('/api/projects/bad').send({ title: 'Changed' }).expect(400)
    await owner.patch('/api/projects/000000000000000000000000').send({ title: 'Changed' }).expect(404)
    expect((await owner.get(path).expect(200)).body.data.title).toBe('Indie Guitar Riff')
  })

  it('rejects invalid and noneditable fields', async () => {
    const agent = await signedIn()
    const created = await agent.post('/api/projects').send(validProject).expect(201)
    const path = `/api/projects/${created.body.data.id}`
    for (const invalid of [{}, { title: ' ' }, { needs: [] }, { needs: ['Triangle'] }, { status: 'archived' }, { genre: 'Polka' }, { bpm: 0 }, { description: 123 }, { owner: '000000000000000000000000' }, { currentVersion: 99 }]) {
      await agent.patch(path).send(invalid).expect(400)
    }
    expect((await agent.get(path).expect(200)).body.data.currentVersion).toBe(1)
  })

  it('closes and reopens projects, controlling browse and contribution access', async () => {
    const owner = await signedIn()
    const other = await signedIn(bob)
    const created = await owner.post('/api/projects').send(validProject).expect(201)
    const path = `/api/projects/${created.body.data.id}`
    await owner.patch(path).send({ status: 'closed' }).expect(200)
    expect((await other.get('/api/projects').expect(200)).body.data).toEqual([])
    expect((await owner.get('/api/projects?mine=true').expect(200)).body.data[0].status).toBe('closed')
    await other.post(`${path}/contributions`).send({ note: 'New mix' }).expect(409)
    await owner.patch(path).send({ status: 'open' }).expect(200)
    await other.post(`${path}/contributions`).send({ note: 'New mix' }).expect(201)
    expect((await other.get('/api/projects').expect(200)).body.data[0].currentVersion).toBe(2)
  })
})


describe('branching history and version approvals', () => {
  it('branches from older versions, records added skills and uses the latest version if no parent is specified', async () => {
    const owner = await signedIn()
    const contributor = await signedIn(bob)
    const id = (await owner.post('/api/projects').send(validProject).expect(201)).body.data.id as string
    const path = `/api/projects/${id}/contributions`
    const first = await contributor.post(path).send({ note: 'Drums', baseVersion: 1, skillsAdded: ['Drums', 'Drums'], needs: ['Bass'] }).expect(201)
    expect(first.body.data).toMatchObject({ version: 2, parentVersion: 1, skillsAdded: ['Drums'], approved: false })
    const second = await owner.post(path).send({ note: 'Alternative guitar', baseVersion: 1, skillsAdded: ['Guitar'], approved: true, parentVersion: 99 }).expect(201)
    expect(second.body.data).toMatchObject({ version: 3, parentVersion: 1, skillsAdded: ['Guitar'], approved: false })
    const third = await contributor.post(path).send({ note: 'Alternate drums', baseVersion: 2 }).expect(201)
    expect(third.body.data).toMatchObject({ version: 4, parentVersion: 2, skillsAdded: [], approved: false })
    await contributor.post(path).send({ note: 'Latest mix', skillsAdded: [] }).expect(201)
    expect((await owner.get(path).expect(200)).body.data).toMatchObject([
      { version: 5, parentVersion: 4 }, { version: 4, parentVersion: 2 },
      { version: 3, parentVersion: 1 }, { version: 2, parentVersion: 1 }, { version: 1, parentVersion: null },
    ])
    expect((await owner.get(`/api/projects/${id}`).expect(200)).body.data).toMatchObject({ currentVersion: 5, needs: ['Bass'] })
  })

  it('rejects malformed or nonexistent parents and invalid skills without claiming audio', async () => {
    const owner = await signedIn()
    const id = (await owner.post('/api/projects').send(validProject).expect(201)).body.data.id as string
    const path = `/api/projects/${id}/contributions`
    const recording = await recordingFor(alice.email)
    await owner.post(path).send({ recordingId: recording.id, baseVersion: 1.5 }).expect(400)
    await owner.post(path).send({ recordingId: recording.id, baseVersion: 2 }).expect(404)
    await owner.post(path).send({ recordingId: recording.id, skillsAdded: 'Drums' }).expect(400)
    await owner.post(path).send({ recordingId: recording.id, skillsAdded: ['Triangle'] }).expect(400)
    expect((await Recording.findById(recording.id))?.project).toBeUndefined()
    expect(await Contribution.countDocuments({ project: id })).toBe(1)
  })

  it('persists multiple independent approvals, and repeated approve/unapprove calls are idempotent', async () => {
    const owner = await signedIn()
    const contributor = await signedIn(bob)
    const id = (await owner.post('/api/projects').send(validProject).expect(201)).body.data.id as string
    const path = `/api/projects/${id}/contributions`
    await contributor.post(path).send({ note: 'Version 2', baseVersion: 1 }).expect(201)
    await contributor.post(path).send({ note: 'Version 3', baseVersion: 1 }).expect(201)
    const approval = (version: number) => `${path}/${version}/approval`
    expect((await owner.put(approval(2)).expect(204)).text).toBe('')
    await owner.put(approval(2)).expect(204)
    await owner.put(approval(3)).expect(204)
    expect((await contributor.get(path).expect(200)).body.data).toMatchObject([
      { version: 3, approved: true }, { version: 2, approved: true }, { version: 1, approved: false },
    ])
    await owner.delete(approval(2)).expect(204)
    await owner.delete(approval(2)).expect(204)
    expect((await contributor.get(path).expect(200)).body.data).toMatchObject([
      { version: 3, approved: true }, { version: 2, approved: false }, { version: 1, approved: false },
    ])
    expect((await owner.get(`/api/projects/${id}`).expect(200)).body.data.currentVersion).toBe(3)
  })

  it('enforces owner authorization and rejects invalid or unpublished versions', async () => {
    const owner = await signedIn()
    const contributor = await signedIn(bob)
    const id = (await owner.post('/api/projects').send(validProject).expect(201)).body.data.id as string
    const path = `/api/projects/${id}/contributions`
    const approval = `${path}/1/approval`
    await request(app).put(approval).expect(401)
    await request(app).delete(approval).expect(401)
    await contributor.put(approval).expect(403)
    await contributor.delete(approval).expect(403)
    await owner.put(approval).set('Origin', 'https://untrusted.example').expect(403)
    await owner.put(`${path}/0/approval`).expect(400)
    await owner.delete(`${path}/1.5/approval`).expect(400)
    await owner.put(`${path}/9007199254740992/approval`).expect(400)
    await owner.put(`${path}/2/approval`).expect(404)
    await owner.delete('/api/projects/000000000000000000000000/contributions/1/approval').expect(404)
    expect((await owner.get(path).expect(200)).body.data).toMatchObject([{ version: 1, approved: false }])
    // Owners may also approve the original and approve versions of a closed project.
    await owner.patch(`/api/projects/${id}`).send({ status: 'closed' }).expect(200)
    await owner.put(approval).expect(204)
    expect((await contributor.get(path).expect(200)).body.data).toMatchObject([{ version: 1, approved: true }])
  })
})
