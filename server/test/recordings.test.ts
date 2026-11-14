import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  S3Client,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { User } from '../src/auth/user.model.js'
import { loadConfig } from '../src/config.js'
import { Recording } from '../src/recordings/recording.model.js'

const BUCKET = 'chorus-audio'
const REGION = 'us-east-2'
const MAX_BYTES = 20 * 1024 * 1024
const config = loadConfig({ NODE_ENV: 'test', S3_BUCKET: BUCKET, AWS_REGION: REGION })

// Fake credentials: presigning is pure local crypto, and every command sent
// through the client is intercepted by aws-sdk-client-mock. No network.
const s3 = new S3Client({
  region: REGION,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  requestChecksumCalculation: 'WHEN_REQUIRED',
})
const s3Mock = mockClient(s3)

function makeApp() {
  return createApp(config, { clientDist: null, bcryptRounds: 4, s3 })
}

const alice = { email: 'alice@example.com', password: 'correct horse', displayName: 'Alice' }
const bob = { email: 'bob@example.com', password: 'battery staple', displayName: 'Bob' }

async function signedIn(app: ReturnType<typeof makeApp>, user = alice) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/signup').send(user).expect(201)
  return { agent, userId: res.body.data.id as string }
}

function decodePolicy(fields: Record<string, string>) {
  return JSON.parse(Buffer.from(fields.Policy, 'base64').toString('utf8')) as {
    expiration: string
    conditions: unknown[]
  }
}

function mockStoredObject(size: number, contentType: string) {
  s3Mock.on(HeadObjectCommand).resolves({ ContentLength: size, ContentType: contentType })
  s3Mock.on(CopyObjectCommand).resolves({})
  s3Mock.on(DeleteObjectCommand).resolves({})
}

function notFound() {
  return new NotFound({ $metadata: { httpStatusCode: 404 }, message: 'NotFound' })
}

/** Creates a pending recording through the API; returns its id and pending key. */
async function presign(agent: request.Agent, contentType = 'audio/mp4', size = 5 * 1024 * 1024) {
  const res = await agent.post('/api/recordings').send({ contentType, size }).expect(201)
  const id = res.body.data.recordingId as string
  const doc = await Recording.findById(id)
  return { id, pendingKey: doc!.pendingKey, res }
}

beforeAll(async () => {
  await Promise.all([User.init(), Recording.init()])
})

beforeEach(() => {
  s3Mock.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/recordings (presign)', () => {
  it('returns 201 with a presigned POST whose policy pins size, exact type and a pending key', async () => {
    const { agent, userId } = await signedIn(makeApp())
    const contentType = 'audio/webm;codecs=opus'
    const res = await agent.post('/api/recordings').send({ contentType, size: 12345 })
    expect(res.status).toBe(201)

    const { recordingId, url, fields } = res.body.data
    expect(mongoose.isValidObjectId(recordingId)).toBe(true)
    expect(url).toBe(`https://${BUCKET}.s3.${REGION}.amazonaws.com/`)
    expect(fields.key).toMatch(new RegExp(`^pending/${userId}/[0-9a-f-]{36}$`))
    expect(fields['Content-Type']).toBe(contentType)
    expect(fields['X-Amz-Signature']).toMatch(/^[0-9a-f]{64}$/)

    const policy = decodePolicy(fields)
    expect(policy.conditions).toContainEqual(['content-length-range', 1, MAX_BYTES])
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', contentType])
    expect(policy.conditions).toContainEqual({ key: fields.key })
    expect(policy.conditions).toContainEqual({ bucket: BUCKET })
    const expiresIn = Date.parse(policy.expiration) - Date.now()
    expect(expiresIn).toBeGreaterThan(290_000)
    expect(expiresIn).toBeLessThanOrEqual(300_000)

    const doc = await Recording.findById(recordingId)
    expect(doc?.status).toBe('pending')
    expect(doc?.pendingKey).toBe(fields.key)
    expect(String(doc?.owner)).toBe(userId)
    expect(doc?.key).toBeUndefined()
    expect(s3Mock.calls()).toHaveLength(0)
  })

  it.each([
    ['a video content type', { contentType: 'video/mp4', size: 1000 }],
    ['a 30 MB size', { contentType: 'audio/mp4', size: 30 * 1024 * 1024 }],
    ['a zero size', { contentType: 'audio/mp4', size: 0 }],
    ['a fractional size', { contentType: 'audio/mp4', size: 10.5 }],
    ['a string size', { contentType: 'audio/mp4', size: '1000' }],
    ['a missing content type', { size: 1000 }],
    ['an over-long content type', { contentType: `audio/${'x'.repeat(100)}`, size: 1000 }],
  ])('rejects %s with 400 and creates nothing', async (_name, body) => {
    const { agent } = await signedIn(makeApp())
    const res = await agent.post('/api/recordings').send(body)
    expect(res.status).toBe(400)
    expect(res.body.data).toBeNull()
    expect(res.body.message.length).toBeGreaterThan(0)
    expect(await Recording.countDocuments()).toBe(0)
  })

  it('returns 401 without a session', async () => {
    const res = await request(makeApp())
      .post('/api/recordings')
      .send({ contentType: 'audio/mp4', size: 1000 })
    expect(res.status).toBe(401)
    expect(await Recording.countDocuments()).toBe(0)
  })
})

describe('POST /api/recordings/:id/confirm', () => {
  it('promotes a valid upload: copy then delete, status ready, key under audio/', async () => {
    const { agent, userId } = await signedIn(makeApp())
    const { id, pendingKey } = await presign(agent)
    mockStoredObject(5 * 1024 * 1024, 'audio/mp4')

    const res = await agent.post(`/api/recordings/${id}/confirm`).send({ durationMs: 4200 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      id,
      ownerId: userId,
      status: 'ready',
      contentType: 'audio/mp4',
      size: 5 * 1024 * 1024,
      durationMs: 4200,
      createdAt: expect.any(String),
    })
    // No S3 keys reach the client.
    expect(JSON.stringify(res.body)).not.toMatch(/pending\/|audio\/[0-9a-f]{24}\/|"key"|pendingKey/)

    const head = s3Mock.commandCalls(HeadObjectCommand)
    expect(head).toHaveLength(1)
    expect(head[0].args[0].input).toEqual({ Bucket: BUCKET, Key: pendingKey })

    const uuid = pendingKey.split('/').pop()
    const audioKey = `audio/${userId}/${uuid}`
    const copy = s3Mock.commandCalls(CopyObjectCommand)
    expect(copy).toHaveLength(1)
    expect(copy[0].args[0].input).toMatchObject({
      Bucket: BUCKET,
      Key: audioKey,
      CopySource: `${BUCKET}/${pendingKey}`,
    })

    const del = s3Mock.commandCalls(DeleteObjectCommand)
    expect(del).toHaveLength(1)
    expect(del[0].args[0].input).toEqual({ Bucket: BUCKET, Key: pendingKey })

    // Order: head, copy, delete.
    const order = s3Mock.calls().map((call) => call.args[0].constructor.name)
    expect(order).toEqual(['HeadObjectCommand', 'CopyObjectCommand', 'DeleteObjectCommand'])

    const doc = await Recording.findById(id)
    expect(doc?.status).toBe('ready')
    expect(doc?.key).toBe(audioKey)
  })

  it('accepts a confirm without a body (durationMs is optional)', async () => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    mockStoredObject(1000, 'audio/mp4')
    const res = await agent.post(`/api/recordings/${id}/confirm`)
    expect(res.status).toBe(200)
    expect(res.body.data.durationMs).toBeNull()
  })

  it('returns an already-ready recording with 200 and no S3 calls', async () => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    mockStoredObject(1000, 'audio/mp4')
    const first = await agent.post(`/api/recordings/${id}/confirm`).send({ durationMs: 1000 })
    expect(first.status).toBe(200)

    s3Mock.reset()
    const again = await agent.post(`/api/recordings/${id}/confirm`).send({ durationMs: 1000 })
    expect(again.status).toBe(200)
    expect(again.body.data).toEqual(first.body.data)
    expect(s3Mock.calls()).toHaveLength(0)
  })

  it('returns 409 and leaves the recording pending when HeadObject reports NotFound', async () => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    s3Mock.on(HeadObjectCommand).rejects(notFound())

    const res = await agent.post(`/api/recordings/${id}/confirm`).send({})
    expect(res.status).toBe(409)
    expect(res.body.data).toBeNull()
    expect((await Recording.findById(id))?.status).toBe('pending')
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0)
  })

  it('returns 200 when HeadObject misses because a concurrent confirm already finished', async () => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    s3Mock.on(HeadObjectCommand).callsFake(async () => {
      await Recording.updateOne(
        { _id: id },
        { status: 'ready', key: 'audio/x/y', size: 1000, contentType: 'audio/mp4' },
      )
      throw notFound()
    })

    const res = await agent.post(`/api/recordings/${id}/confirm`).send({})
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ready')
  })

  it('returns 409 when CopyObject reports NoSuchKey and the recording is still pending', async () => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1000, ContentType: 'audio/mp4' })
    s3Mock
      .on(CopyObjectCommand)
      .rejects(new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'NoSuchKey' }))

    const res = await agent.post(`/api/recordings/${id}/confirm`).send({})
    expect(res.status).toBe(409)
    expect((await Recording.findById(id))?.status).toBe('pending')
  })

  it.each([
    ['a 25 MB object', 25 * 1024 * 1024, 'audio/mp4'],
    ['an empty object', 0, 'audio/mp4'],
    ['a non-audio object', 1000, 'text/html'],
  ])('rejects %s with 422, marks it rejected and deletes it', async (_name, size, type) => {
    const { agent } = await signedIn(makeApp())
    const { id, pendingKey } = await presign(agent)
    mockStoredObject(size, type)

    const res = await agent.post(`/api/recordings/${id}/confirm`).send({})
    expect(res.status).toBe(422)
    expect(res.body.data).toBeNull()
    expect((await Recording.findById(id))?.status).toBe('rejected')
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0)
    const del = s3Mock.commandCalls(DeleteObjectCommand)
    expect(del).toHaveLength(1)
    expect(del[0].args[0].input).toEqual({ Bucket: BUCKET, Key: pendingKey })
  })

  it('still returns 200 when deleting the pending object fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    mockStoredObject(1000, 'audio/mp4')
    s3Mock.on(DeleteObjectCommand).rejects(new Error('S3 hiccup'))

    const res = await agent.post(`/api/recordings/${id}/confirm`).send({})
    expect(res.status).toBe(200)
    expect((await Recording.findById(id))?.status).toBe('ready')
  })

  it.each([
    ['a zero', 0],
    ['a negative', -5],
    ['a fractional', 12.5],
    ['an over-30-minute', 30 * 60 * 1000 + 1],
    ['a string', '1000'],
  ])('rejects %s durationMs with 400 before touching S3', async (_name, durationMs) => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    const res = await agent.post(`/api/recordings/${id}/confirm`).send({ durationMs })
    expect(res.status).toBe(400)
    expect(s3Mock.calls()).toHaveLength(0)
    expect((await Recording.findById(id))?.status).toBe('pending')
  })

  it("returns 404 for another user's recording without touching S3", async () => {
    const app = makeApp()
    const { agent } = await signedIn(app, alice)
    const { id } = await presign(agent)
    const { agent: other } = await signedIn(app, bob)

    const res = await other.post(`/api/recordings/${id}/confirm`).send({})
    expect(res.status).toBe(404)
    expect(res.body.data).toBeNull()
    expect(s3Mock.calls()).toHaveLength(0)
  })

  it('returns 404 for an unknown id and 400 for an invalid ObjectId', async () => {
    const { agent } = await signedIn(makeApp())
    const unknown = new mongoose.Types.ObjectId().toString()
    expect((await agent.post(`/api/recordings/${unknown}/confirm`).send({})).status).toBe(404)
    expect((await agent.post('/api/recordings/not-an-id/confirm').send({})).status).toBe(400)
  })

  it('returns 401 without a session', async () => {
    const id = new mongoose.Types.ObjectId().toString()
    expect((await request(makeApp()).post(`/api/recordings/${id}/confirm`)).status).toBe(401)
  })

  it('handles two concurrent confirms: both 200, one ready document, no duplicate key', async () => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    mockStoredObject(1000, 'audio/mp4')

    const [a, b] = await Promise.all([
      agent.post(`/api/recordings/${id}/confirm`).send({ durationMs: 500 }),
      agent.post(`/api/recordings/${id}/confirm`).send({ durationMs: 500 }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.data.status).toBe('ready')
    expect(b.body.data.status).toBe('ready')
    expect(await Recording.countDocuments()).toBe(1)
    expect(await Recording.countDocuments({ status: 'ready' })).toBe(1)
  })
})

describe('GET /api/recordings', () => {
  it('lists only ready recordings, newest first, with owner display names', async () => {
    const app = makeApp()
    const { agent: a, userId: aliceId } = await signedIn(app, alice)
    const { agent: b, userId: bobId } = await signedIn(app, bob)
    mockStoredObject(1000, 'audio/mp4')

    const older = await presign(a)
    await a.post(`/api/recordings/${older.id}/confirm`).send({}).expect(200)
    const newer = await presign(b)
    await b.post(`/api/recordings/${newer.id}/confirm`).send({}).expect(200)
    await presign(a) // stays pending
    await Recording.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(older.id) },
      { $set: { createdAt: new Date(Date.now() - 60_000) } },
    )

    const res = await a.get('/api/recordings')
    expect(res.status).toBe(200)
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([newer.id, older.id])
    expect(res.body.data[0]).toMatchObject({ ownerId: bobId, ownerDisplayName: 'Bob', status: 'ready' })
    expect(res.body.data[1]).toMatchObject({ ownerId: aliceId, ownerDisplayName: 'Alice' })
    expect(JSON.stringify(res.body)).not.toMatch(/pendingKey|"key"|pending\//)
  })

  it('returns 401 without a session', async () => {
    expect((await request(makeApp()).get('/api/recordings')).status).toBe(401)
  })
})

describe('GET /api/recordings/:id/playback-url', () => {
  it('returns a presigned GET for the audio/ key expiring in about an hour', async () => {
    const app = makeApp()
    const { agent, userId } = await signedIn(app, alice)
    const { id, pendingKey } = await presign(agent)
    mockStoredObject(1000, 'audio/mp4')
    await agent.post(`/api/recordings/${id}/confirm`).send({}).expect(200)

    // Any signed-in user may play a ready recording.
    const { agent: listener } = await signedIn(app, bob)
    const res = await listener.get(`/api/recordings/${id}/playback-url`)
    expect(res.status).toBe(200)

    const url = new URL(res.body.data.url)
    expect(url.host).toBe(`${BUCKET}.s3.${REGION}.amazonaws.com`)
    expect(url.pathname).toBe(`/audio/${userId}/${pendingKey.split('/').pop()}`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)

    const expiresIn = Date.parse(res.body.data.expiresAt) - Date.now()
    expect(expiresIn).toBeGreaterThan(3590_000)
    expect(expiresIn).toBeLessThanOrEqual(3600_000)
  })

  it('returns 404 for a pending recording and 400 for an invalid ObjectId', async () => {
    const { agent } = await signedIn(makeApp())
    const { id } = await presign(agent)
    expect((await agent.get(`/api/recordings/${id}/playback-url`)).status).toBe(404)
    expect((await agent.get('/api/recordings/nope/playback-url')).status).toBe(400)
  })

  it('returns 401 without a session', async () => {
    const id = new mongoose.Types.ObjectId().toString()
    expect((await request(makeApp()).get(`/api/recordings/${id}/playback-url`)).status).toBe(401)
  })
})

describe('without a configured bucket', () => {
  it('boots, and recording routes return a 503 envelope', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test' }), { clientDist: null, bcryptRounds: 4 })
    expect((await request(app).get('/api/health')).status).toBe(200)

    const { agent } = await signedIn(app)
    const res = await agent.post('/api/recordings').send({ contentType: 'audio/mp4', size: 1000 })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ message: 'Audio storage is not configured', data: null })
    expect((await agent.get('/api/recordings')).status).toBe(503)
    expect(await Recording.countDocuments()).toBe(0)
  })
})
