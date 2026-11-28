// Builds the Express app without listening, so tests can drive it with
// supertest. Everything stateful (routers, rate limiters, the session store) is
// created per call; nothing leaks between app instances.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { S3Client } from '@aws-sdk/client-s3'
import express, { Router, type Express } from 'express'
import type { Store } from 'express-session'
import helmet from 'helmet'
import { originCheck, requireJsonBody } from './auth/guards.js'
import { authRouter } from './auth/routes.js'
import { createSessionStore, sessionMiddleware } from './auth/session.js'
import type { Config } from './config.js'
import { dbState } from './db.js'
import { apiNotFound, errorHandler, respond } from './http.js'
import { projectsRouter } from './projects/routes.js'
import { recordingsRouter } from './recordings/routes.js'
import { createS3Client, s3Storage } from './storage/s3.js'

/** client/dist, resolved from this file: works from server/src (tsx) and server/dist (compiled). */
export const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url))

export interface AppDeps {
  /** Built SPA directory. `null` disables static hosting; a missing directory is skipped. */
  clientDist?: string | null
  /** Extra routers mounted under /api, after the built-in ones and before the /api 404. */
  apiRouters?: Router[]
  /** Session store. Defaults to connect-mongo on Mongoose's connection. */
  sessionStore?: Store
  /** bcrypt cost factor. Defaults to 12; tests pass a low value for speed. */
  bcryptRounds?: number
  /** S3 client. Defaults to one built from config.aws; tests pass one with fake credentials. */
  s3?: S3Client
}

function healthRouter(): Router {
  const router = Router()
  router.get('/health', (_req, res) => {
    respond(res, 200, 'OK', { db: dbState() })
  })
  return router
}

export function createApp(config: Config, deps: AppDeps = {}): Express {
  const app = express()

  app.set('trust proxy', config.trustProxy)

  const s3 = config.s3Origin ? [config.s3Origin] : []
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          mediaSrc: ["'self'", 'blob:', ...s3],
          connectSrc: ["'self'", ...s3],
        },
      },
    }),
  )

  // CSRF defenses (KTD4) run before any body parsing or session work.
  app.use('/api', originCheck(config.appOrigins), requireJsonBody)
  app.use(express.json())
  // Health needs no session, so it skips the session store lookup.
  app.use('/api', healthRouter())
  app.use('/api', sessionMiddleware(config, deps.sessionStore ?? createSessionStore()))

  // Without a bucket (local dev without AWS) the app still boots and the
  // recording routes answer 503.
  const bucket = config.aws.bucket
  const storage = bucket ? s3Storage(deps.s3 ?? createS3Client(config), bucket) : null

  // API: built-in routers, then extra routers.
  app.use('/api', authRouter(config, { bcryptRounds: deps.bcryptRounds }))
  app.use('/api', recordingsRouter(storage))
  app.use('/api', projectsRouter())
  for (const router of deps.apiRouters ?? []) app.use('/api', router)
  app.use('/api', apiNotFound)

  // SPA: static assets, then index.html for client-side routes. /api never
  // reaches here because the /api 404 above ends every unmatched API request.
  const clientDist = deps.clientDist === undefined ? DEFAULT_CLIENT_DIST : deps.clientDist
  if (clientDist && existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist))
    app.get('/{*splat}', (_req, res, next) => {
      res.sendFile('index.html', { root: clientDist }, (err) => {
        if (err) next(err)
      })
    })
  }

  app.use(errorHandler)
  return app
}
