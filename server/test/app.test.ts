import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Router } from 'express'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { HttpError } from '../src/http.js'

const testConfig = loadConfig({ NODE_ENV: 'test' })

const productionEnv = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://db.example/chorus',
  SESSION_SECRET: 'x'.repeat(32),
  APP_ORIGIN: 'https://chorus.example, https://www.chorus.example',
  S3_BUCKET: 'chorus-audio',
  AWS_REGION: 'us-east-2',
}

// Routes that exist only to exercise the error middleware.
function throwingRouter() {
  const router = Router()
  router.get('/teapot', () => {
    throw new HttpError(418, 'x')
  })
  router.get('/boom', async () => {
    throw new Error('secret internal detail')
  })
  router.get('/validation', () => {
    throw new mongoose.Error.ValidationError()
  })
  router.get('/duplicate', () => {
    throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
  })
  return router
}

describe('loadConfig', () => {
  it('throws in production when SESSION_SECRET is shorter than 32 characters', () => {
    expect(() => loadConfig({ ...productionEnv, SESSION_SECRET: 'tenchars!!' })).toThrow(
      /SESSION_SECRET/,
    )
  })

  it.each(['MONGODB_URI', 'SESSION_SECRET', 'APP_ORIGIN', 'S3_BUCKET', 'AWS_REGION'])(
    'throws in production when %s is missing',
    (name) => {
      const env: Record<string, string | undefined> = { ...productionEnv }
      delete env[name]
      expect(() => loadConfig(env)).toThrow(new RegExp(name))
    },
  )

  it('parses a complete production env', () => {
    const config = loadConfig(productionEnv)
    expect(config.nodeEnv).toBe('production')
    expect(config.appOrigins).toEqual(['https://chorus.example', 'https://www.chorus.example'])
    expect(config.trustProxy).toBe(1)
    expect(config.s3Origin).toBe('https://chorus-audio.s3.us-east-2.amazonaws.com')
  })

  it('takes trust proxy as a hop count and never as true', () => {
    expect(loadConfig({ ...productionEnv, TRUST_PROXY: '2' }).trustProxy).toBe(2)
    expect(() => loadConfig({ ...productionEnv, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/)
  })

  it('uses development defaults without a bucket', () => {
    const config = loadConfig({})
    expect(config.nodeEnv).toBe('development')
    expect(config.port).toBe(3000)
    expect(config.trustProxy).toBe(false)
    expect(config.s3Origin).toBeUndefined()
    expect(config.appOrigins).toEqual(['http://localhost:5173'])
  })
})

describe('createApp API', () => {
  const app = createApp(testConfig, { clientDist: null, apiRouters: [throwingRouter()] })

  it('GET /api/health returns the envelope with db state', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'OK', data: { db: 'connected' } })
  })

  it('GET /api/nope returns the 404 envelope', async () => {
    const res = await request(app).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ message: 'Endpoint not found', data: null })
  })

  it('maps HttpError to its status and message', async () => {
    const res = await request(app).get('/api/teapot')
    expect(res.status).toBe(418)
    expect(res.body).toEqual({ message: 'x', data: null })
  })

  it('maps an unexpected error to a generic 500 without internals', async () => {
    const res = await request(app).get('/api/boom')
    expect(res.status).toBe(500)
    expect(res.body.data).toBeNull()
    expect(JSON.stringify(res.body)).not.toMatch(/secret internal detail|at /)
  })

  it('maps a malformed JSON body to a 400 envelope', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"oops":')
    expect(res.status).toBe(400)
    expect(res.body.data).toBeNull()
    expect(typeof res.body.message).toBe('string')
  })

  it('maps a Mongoose validation error to 400 and a duplicate key to 409', async () => {
    expect((await request(app).get('/api/validation')).status).toBe(400)
    expect((await request(app).get('/api/duplicate')).status).toBe(409)
  })

  it('sets helmet headers with the S3 origin in media-src and connect-src', async () => {
    const s3App = createApp(loadConfig({ ...productionEnv, NODE_ENV: 'test' }), {
      clientDist: null,
    })
    const res = await request(s3App).get('/api/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    const csp = String(res.headers['content-security-policy'])
    const directive = (name: string) =>
      csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''
    const origin = 'https://chorus-audio.s3.us-east-2.amazonaws.com'
    expect(directive('media-src')).toContain(origin)
    expect(directive('media-src')).toContain('blob:')
    expect(directive('connect-src')).toContain(origin)
  })
})

describe('createApp SPA hosting', () => {
  let dist: string

  beforeAll(() => {
    dist = mkdtempSync(path.join(tmpdir(), 'chorus-dist-'))
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Chorus SPA</title>')
  })

  afterAll(() => {
    rmSync(dist, { recursive: true, force: true })
  })

  it('serves index.html for a client-side route', async () => {
    const app = createApp(testConfig, { clientDist: dist })
    const res = await request(app).get('/some/client/route')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('Chorus SPA')
  })

  it('still returns the 404 envelope for unknown /api paths', async () => {
    const app = createApp(testConfig, { clientDist: dist })
    const res = await request(app).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ message: 'Endpoint not found', data: null })
  })

  it('skips static hosting when the client build is missing', async () => {
    const app = createApp(testConfig, { clientDist: path.join(dist, 'does-not-exist') })
    const res = await request(app).get('/some/client/route')
    expect(res.status).toBe(404)
  })
})
