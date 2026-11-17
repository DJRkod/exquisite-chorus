import bcrypt from 'bcryptjs'
import { Router } from 'express'
import mongoose from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from '../src/app.js'
import { requireAuth } from '../src/auth/guards.js'
import { SESSION_COOKIE } from '../src/auth/session.js'
import { User } from '../src/auth/user.model.js'
import { loadConfig } from '../src/config.js'
import { respond } from '../src/http.js'

const APP_ORIGIN = 'http://localhost:5173'
const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN })

// A data route behind the guard, standing in for U4's recordings routes.
function privateRouter(): Router {
  const router = Router()
  router.get('/private', requireAuth, (req, res) => {
    respond(res, 200, 'OK', { userId: req.user?.id })
  })
  return router
}

function makeApp(deps: AppDeps = {}) {
  return createApp(config, {
    clientDist: null,
    bcryptRounds: 4,
    apiRouters: [privateRouter()],
    ...deps,
  })
}

const alice = { email: 'alice@example.com', password: 'correct horse', displayName: 'Alice' }

function sessionCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  return raw?.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
}

function cookieValue(cookie: string | undefined): string | undefined {
  return cookie?.split(';')[0]
}

beforeAll(async () => {
  // Build the unique email index so duplicate sign-ups hit a real E11000.
  await User.init()
})

describe('POST /api/auth/signup', () => {
  it('returns 201 with the user, no passwordHash, and a session cookie that /me accepts', async () => {
    const agent = request.agent(makeApp())
    const res = await agent.post('/api/auth/signup').send(alice)
    expect(res.status).toBe(201)
    expect(res.body.data).toEqual({
      id: expect.any(String),
      email: 'alice@example.com',
      displayName: 'Alice',
      skills: [],
    })
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|__v|_id/)

    const cookie = sessionCookie(res)
    expect(cookie).toBeDefined()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).not.toMatch(/Secure/i)

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data).toEqual(res.body.data)
  })

  it('persists the session in MongoDB', async () => {
    const agent = request.agent(makeApp())
    await agent.post('/api/auth/signup').send(alice).expect(201)
    const sessions = await mongoose.connection.db!.collection('sessions').countDocuments()
    expect(sessions).toBe(1)
  })

  it('returns 409 for an email that differs only in case', async () => {
    const app = makeApp()
    await request(app).post('/api/auth/signup').send({ ...alice, email: 'Foo@X.com' }).expect(201)
    const res = await request(app).post('/api/auth/signup').send({ ...alice, email: 'foo@x.com' })
    expect(res.status).toBe(409)
    expect(res.body.data).toBeNull()
    expect(typeof res.body.message).toBe('string')
  })

  it('trims email and display name', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .send({ ...alice, email: '  Alice@Example.COM ', displayName: '  Alice  ' })
    expect(res.status).toBe(201)
    expect(res.body.data.email).toBe('alice@example.com')
    expect(res.body.data.displayName).toBe('Alice')
  })

  it.each([
    ['a 7-character password', { ...alice, password: '1234567' }],
    ['a password over 128 characters', { ...alice, password: 'x'.repeat(129) }],
    ['a malformed email', { ...alice, email: 'not-an-email' }],
    ['a missing display name', { ...alice, displayName: '   ' }],
    ['a display name over 50 characters', { ...alice, displayName: 'x'.repeat(51) }],
    ['a non-string password', { ...alice, password: 12345678 }],
  ])('rejects %s with a 400 envelope', async (_name, body) => {
    const res = await request(makeApp()).post('/api/auth/signup').send(body)
    expect(res.status).toBe(400)
    expect(res.body.data).toBeNull()
    expect(res.body.message.length).toBeGreaterThan(0)
    expect(await User.countDocuments()).toBe(0)
  })

  it('stores a bcrypt hash that verifies and is not the plaintext', async () => {
    await request(makeApp()).post('/api/auth/signup').send(alice).expect(201)
    const user = await User.findOne({ email: alice.email }).lean()
    expect(user?.passwordHash).toBeDefined()
    expect(user?.passwordHash).not.toBe(alice.password)
    expect(await bcrypt.compare(alice.password, user!.passwordHash)).toBe(true)
    expect(await bcrypt.compare('wrong password', user!.passwordHash)).toBe(false)
  })

  it('rate-limits sign-ups from one IP: the 11th returns 429', async () => {
    const app = makeApp()
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/auth/signup')
        .send({ ...alice, email: `user${i}@example.com` })
        .expect(201)
    }
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...alice, email: 'user10@example.com' })
    expect(res.status).toBe(429)
    expect(res.body.data).toBeNull()
    expect(typeof res.body.message).toBe('string')
  })
})

describe('login, logout and /me', () => {
  it('logs in with a cookie, logs out with 204, and /me then returns 401', async () => {
    const app = makeApp()
    await request(app).post('/api/auth/signup').send(alice).expect(201)

    const agent = request.agent(app)
    const login = await agent
      .post('/api/auth/login')
      .send({ email: alice.email, password: alice.password })
    expect(login.status).toBe(200)
    expect(login.body.data).toMatchObject({ email: alice.email, displayName: 'Alice' })
    expect(login.body.data.passwordHash).toBeUndefined()
    expect(sessionCookie(login)).toBeDefined()
    expect((await agent.get('/api/auth/me')).status).toBe(200)

    const logout = await agent.post('/api/auth/logout')
    expect(logout.status).toBe(204)
    expect(sessionCookie(logout)).toMatch(/Expires=Thu, 01 Jan 1970/)

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(401)
    expect(me.body.data).toBeNull()
  })

  it('accepts a login email in a different case', async () => {
    const app = makeApp()
    await request(app).post('/api/auth/signup').send(alice).expect(201)
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ' ALICE@example.com ', password: alice.password })
    expect(res.status).toBe(200)
  })

  it('returns identical 401 bodies for an unknown email and a wrong password', async () => {
    const app = makeApp()
    await request(app).post('/api/auth/signup').send(alice).expect(201)
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: alice.password })
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: alice.email, password: 'wrong password' })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(unknown.body).toEqual(wrong.body)
    expect(unknown.body.data).toBeNull()
    expect(sessionCookie(unknown)).toBeUndefined()
  })

  it('returns 401 from /me without a cookie', async () => {
    const res = await request(makeApp()).get('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.data).toBeNull()
  })

  it('returns 429 envelope on the 11th login attempt for one IP and email', async () => {
    const app = makeApp()
    const attempt = (email: string) =>
      request(app).post('/api/auth/login').send({ email, password: 'wrong password' })
    for (let i = 0; i < 10; i++) expect((await attempt(alice.email)).status).toBe(401)

    const limited = await attempt(alice.email)
    expect(limited.status).toBe(429)
    expect(limited.body.data).toBeNull()
    expect(typeof limited.body.message).toBe('string')
    expect(limited.headers['ratelimit']).toBeDefined()

    // The key is IP + email: same email in another case is the same key,
    // a different email from the same IP is not.
    expect((await attempt('ALICE@example.com')).status).toBe(429)
    expect((await attempt('bob@example.com')).status).toBe(401)
  })

  it('regenerates the session ID on login', async () => {
    const agent = request.agent(makeApp())
    const signup = await agent.post('/api/auth/signup').send(alice)
    const before = cookieValue(sessionCookie(signup))
    const login = await agent
      .post('/api/auth/login')
      .send({ email: alice.email, password: alice.password })
    const after = cookieValue(sessionCookie(login))
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
    // Only the new session survives.
    expect(await mongoose.connection.db!.collection('sessions').countDocuments()).toBe(1)
  })
})

describe('requireAuth', () => {
  it('returns 401 without a cookie', async () => {
    const res = await request(makeApp()).get('/api/private')
    expect(res.status).toBe(401)
    expect(res.body.data).toBeNull()
  })

  it('attaches req.user for a signed-in request', async () => {
    const agent = request.agent(makeApp())
    const signup = await agent.post('/api/auth/signup').send(alice).expect(201)
    const res = await agent.get('/api/private')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ userId: signup.body.data.id })
  })

  it('returns 401 when the session user no longer exists', async () => {
    const agent = request.agent(makeApp())
    await agent.post('/api/auth/signup').send(alice).expect(201)
    await User.deleteMany({})
    expect((await agent.get('/api/private')).status).toBe(401)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
  })
})

describe('CSRF defenses', () => {
  it('rejects logout with a foreign Origin with 403', async () => {
    const res = await request(makeApp())
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.example')
    expect(res.status).toBe(403)
    expect(res.body.data).toBeNull()
  })

  it('rejects signup with a foreign Origin with 403 and creates no user', async () => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .set('Origin', 'https://evil.example')
      .send(alice)
    expect(res.status).toBe(403)
    expect(await User.countDocuments()).toBe(0)
  })

  it('allows the configured app origin', async () => {
    const res = await request(makeApp()).post('/api/auth/logout').set('Origin', APP_ORIGIN)
    expect(res.status).toBe(204)
  })

  it.each([
    ['text/plain', JSON.stringify(alice)],
    ['application/x-www-form-urlencoded', 'email=a%40b.co&password=12345678&displayName=A'],
  ])('rejects a %s body with 415', async (type, body) => {
    const res = await request(makeApp())
      .post('/api/auth/signup')
      .set('Content-Type', type)
      .send(body)
    expect(res.status).toBe(415)
    expect(res.body.data).toBeNull()
    expect(await User.countDocuments()).toBe(0)
  })
})

describe('session cookie in production', () => {
  it('is Secure behind a TLS-terminating proxy', async () => {
    const prodConfig = loadConfig({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://unused.example/chorus',
      SESSION_SECRET: 'x'.repeat(32),
      APP_ORIGIN,
      S3_BUCKET: 'chorus-audio',
      AWS_REGION: 'us-east-2',
    })
    const app = createApp(prodConfig, { clientDist: null, bcryptRounds: 4 })
    const res = await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-Proto', 'https')
      .send(alice)
    expect(res.status).toBe(201)
    expect(sessionCookie(res)).toMatch(/Secure/)
  })
})
