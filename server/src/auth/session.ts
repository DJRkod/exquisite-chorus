// Server-side sessions (KTD3): express-session with a connect-mongo store that
// reuses Mongoose's MongoClient, so the app holds one connection pool.
import MongoStore from 'connect-mongo'
import session, { type Store } from 'express-session'
import type { RequestHandler } from 'express'
import mongoose from 'mongoose'
import type { Config } from '../config.js'

declare module 'express-session' {
  interface SessionData {
    userId?: string
  }
}

type MongoClient = ReturnType<typeof mongoose.connection.getClient>

export const SESSION_COOKIE = 'ec.sid'
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60

/**
 * Mongoose's client once connected. Waits (never rejects) when the app is
 * built before the connection opens, as in tests or a dev server without a
 * database; session reads and writes simply wait for the connection.
 */
function mongooseClient(): Promise<MongoClient> {
  const connection = mongoose.connection
  if (connection.readyState === mongoose.ConnectionStates.connected) {
    return Promise.resolve(connection.getClient())
  }
  return new Promise((resolve) => {
    connection.once('connected', () => resolve(connection.getClient()))
  })
}

export function createSessionStore(): Store {
  return MongoStore.create({
    clientPromise: mongooseClient(),
    collectionName: 'sessions',
    ttl: SESSION_TTL_SECONDS,
  })
}

/** Cookie attributes shared by the session middleware and logout's clearCookie. */
export function sessionCookieOptions(config: Config) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.nodeEnv === 'production',
    path: '/',
  }
}

export function sessionMiddleware(config: Config, store: Store): RequestHandler {
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: { ...sessionCookieOptions(config), maxAge: SESSION_TTL_SECONDS * 1000 },
  })
}
