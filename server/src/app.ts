// Builds the Express app without listening, so tests can drive it with
// supertest. Everything stateful (routers, and later rate limiters) is created
// per call; nothing leaks between app instances.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { Router, type Express } from 'express'
import helmet from 'helmet'
import type { Config } from './config.js'
import { dbState } from './db.js'
import { apiNotFound, errorHandler, respond } from './http.js'

/** client/dist, resolved from this file: works from server/src (tsx) and server/dist (compiled). */
export const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url))

export interface AppDeps {
  /** Built SPA directory. `null` disables static hosting; a missing directory is skipped. */
  clientDist?: string | null
  /** Extra routers mounted under /api, after the built-in ones and before the /api 404. */
  apiRouters?: Router[]
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
  app.use(express.json())

  // API: feature routers (auth, recordings) mount here in later units.
  app.use('/api', healthRouter())
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
