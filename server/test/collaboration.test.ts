import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import session from 'express-session'
import request from 'supertest'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { User } from '../src/auth/user.model.js'
import { loadConfig } from '../src/config.js'
import { Contribution } from '../src/models/contribution.model.js'
import { Project } from '../src/models/project.model.js'
import { Recording } from '../src/recordings/recording.model.js'

const bucket = 'chorus-audio'
const region = 'us-east-2'
const s3 = new S3Client({
  region,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  requestChecksumCalculation: 'WHEN_REQUIRED',
})
const s3Mock = mockClient(s3)

beforeAll(async () => {
  await Promise.all([User.init(), Project.init(), Contribution.init(), Recording.init()])
})

afterAll(() => {
  s3Mock.restore()
  s3.destroy()
})

// The browser's direct upload is simulated by a successful S3 HEAD response.
// MongoDB and Express are real; no real S3 object is written or downloaded.
async function uploadRecording(agent: request.Agent) {
  const upload = await agent.post('/api/recordings').send({ contentType: 'audio/mp4', size: 1000 }).expect(201)
  const id = upload.body.data.recordingId as string
  expect(upload.body.data.fields.key).toMatch(/^pending\//)
  const ready = await agent.post(`/api/recordings/${id}/confirm`).send({ durationMs: 2000 }).expect(200)
  expect(ready.body.data).toMatchObject({ id, status: 'ready', size: 1000, durationMs: 2000 })
  return id
}

it('connects signup, audio confirmation, publishing, matched discovery, contribution, playback and closure', async () => {
  s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1000, ContentType: 'audio/mp4' })
  s3Mock.on(CopyObjectCommand).resolves({})
  s3Mock.on(DeleteObjectCommand).resolves({})
  const app = createApp(loadConfig({ NODE_ENV: 'test', S3_BUCKET: bucket, AWS_REGION: region }), {
    clientDist: null,
    sessionStore: new session.MemoryStore(),
    bcryptRounds: 4,
    s3,
  })
  const guitarist = request.agent(app)
  const drummer = request.agent(app)
  const bassist = request.agent(app)
  const signup = async (agent: request.Agent, displayName: string, skill: string) => {
    const res = await agent.post('/api/auth/signup').send({
      email: `${displayName.toLowerCase()}@example.com`, password: 'correct horse', displayName, skills: [skill],
    }).expect(201)
    return res.body.data.id as string
  }
  const guitaristId = await signup(guitarist, 'Guitarist', 'Guitar')
  const drummerId = await signup(drummer, 'Drummer', 'Drums')
  await signup(bassist, 'Bassist', 'Bass')

  const original = await uploadRecording(guitarist)
  const created = await guitarist.post('/api/projects').send({
    title: 'Guitar riff', recordingId: original, needs: ['Drums'], genre: 'Rock', bpm: 120,
  }).expect(201)
  const id = created.body.data.id as string
  const path = `/api/projects/${id}`
  expect(created.body.data).toMatchObject({ ownerId: guitaristId, currentVersion: 1, needs: ['Drums'] })
  const matched = '/api/projects?matched=true&genre=Rock'
  expect((await drummer.get(matched).expect(200)).body.data).toMatchObject([{ id }])
  expect((await bassist.get(matched).expect(200)).body.data).toEqual([])
  const history = await drummer.get(`${path}/contributions`).expect(200)
  expect(history.body.data).toMatchObject([{ version: 1, recordingId: original, contributorId: guitaristId }])
  const playback = await drummer.get(`/api/recordings/${original}/playback-url`).expect(200)
  const originalUrl = new URL(playback.body.data.url)
  expect(originalUrl.pathname).toMatch(new RegExp(`^/audio/${guitaristId}/`))
  expect(originalUrl.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)

  const mix = await uploadRecording(drummer)
  const contributed = await drummer.post(`${path}/contributions`).send({
    recordingId: mix, note: 'Added drums', baseVersion: 1, needs: ['Bass'],
  }).expect(201)
  expect(contributed.body.data).toMatchObject({ version: 2, contributorId: drummerId, recordingId: mix })
  expect((await guitarist.get(path).expect(200)).body.data).toMatchObject({ currentVersion: 2, needs: ['Bass'] })
  expect((await drummer.get(matched).expect(200)).body.data).toEqual([])
  expect((await bassist.get(matched).expect(200)).body.data).toMatchObject([{ id, currentVersion: 2 }])
  expect((await bassist.get(`${path}/contributions`).expect(200)).body.data).toMatchObject([
    { version: 2, recordingId: mix }, { version: 1, recordingId: original },
  ])
  const nextPlayback = await bassist.get(`/api/recordings/${mix}/playback-url`).expect(200)
  expect(new URL(nextPlayback.body.data.url).pathname).toMatch(new RegExp(`^/audio/${drummerId}/`))
  expect(await Recording.countDocuments({ project: id, status: 'ready' })).toBe(2)
  expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(2)

  await drummer.patch(path).send({ status: 'closed' }).expect(403)
  await guitarist.patch(path).send({ status: 'closed' }).expect(200)
  expect((await bassist.get(matched).expect(200)).body.data).toEqual([])
  expect((await guitarist.get('/api/projects?mine=true').expect(200)).body.data).toMatchObject([{ id, status: 'closed' }])
  await bassist.post(`${path}/contributions`).send({ note: 'Bass idea', baseVersion: 2 }).expect(409)
  await guitarist.post('/api/auth/logout').expect(204)
  await guitarist.get(path).expect(401)
})
