// /api/auth: sign up, sign in, sign out, and the current user.
import type { PublicUser, SignInRequest, SignUpRequest, Skill } from '@exquisite-chorus/shared'
import { SKILLS } from '@exquisite-chorus/shared/vocabulary'
import bcrypt from 'bcryptjs'
import { Router, type Request, type Response } from 'express'
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit'
import type { Config } from '../config.js'
import { field, HttpError, isRecord, respond } from '../http.js'
import { requireAuth } from './guards.js'
import { sessionCookieOptions, SESSION_COOKIE } from './session.js'
import { DISPLAY_NAME_MAX, toPublicUser, User } from './user.model.js'

export const DEFAULT_BCRYPT_ROUNDS = 12
export const INVALID_CREDENTIALS = 'Invalid email or password'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const EMAIL_MAX = 254
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RATE_WINDOW_MS = 15 * 60 * 1000
const RATE_LIMIT = 10

export interface AuthRouterOptions {
  /** bcrypt cost factor; tests lower it for speed. */
  bcryptRounds?: number
}

function normalizeEmail(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : undefined
}

function parseSkills(raw: unknown): Skill[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new HttpError(400, 'Skills must be a list from the skill picker')
  const known = SKILLS as readonly string[]
  const skills = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || !known.includes(item)) {
      throw new HttpError(400, 'Skills must be chosen from the list of instruments and studio skills')
    }
    skills.add(item)
  }
  return [...skills] as Skill[]
}

function parseSignUp(body: unknown): SignUpRequest {
  const email = normalizeEmail(field(body, 'email'))
  const password = field(body, 'password')
  const rawName = field(body, 'displayName')
  const displayName = typeof rawName === 'string' ? rawName.trim() : ''
  const skills = parseSkills(field(body, 'skills'))

  if (!email || email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email)) {
    throw new HttpError(400, 'Enter a valid email address')
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new HttpError(400, `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`)
  }
  if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX) {
    throw new HttpError(400, `Display name must be 1 to ${DISPLAY_NAME_MAX} characters`)
  }
  return { email, password, displayName, ...(skills === undefined ? {} : { skills }) }
}

function parseSignIn(body: unknown): SignInRequest {
  const email = normalizeEmail(field(body, 'email'))
  const password = field(body, 'password')
  if (!email || typeof password !== 'string' || password.length === 0) {
    throw new HttpError(400, 'Email and password are required')
  }
  return { email, password }
}

/** Promisifies a session method that takes a single error-first callback. */
function viaCallback(fn: (callback: (err: unknown) => void) => unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fn((err: unknown) => (err ? reject(err) : resolve()))
  })
}

/** Starts a fresh session (new ID, defeating fixation) for the given user. */
async function signIn(req: Request, userId: string): Promise<void> {
  await viaCallback((cb) => req.session.regenerate(cb))
  req.session.userId = userId
  await viaCallback((cb) => req.session.save(cb))
}

function limiterOptions(): Partial<Options> {
  return {
    windowMs: RATE_WINDOW_MS,
    limit: RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      respond(res, 429, 'Too many attempts. Try again in a few minutes.')
    },
  }
}

export function authRouter(config: Config, options: AuthRouterOptions = {}): Router {
  const rounds = options.bcryptRounds ?? DEFAULT_BCRYPT_ROUNDS
  const cookieOptions = sessionCookieOptions(config)
  // Compared against when the email is unknown, so both failure paths do the
  // same bcrypt work and take about the same time.
  let dummyHash: Promise<string> | undefined
  const timingHash = () => (dummyHash ??= bcrypt.hash('timing-equalizer', rounds))

  // Limiters live per router, so every app (and every test) has its own store.
  const loginLimiter = rateLimit({
    ...limiterOptions(),
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? '')}|${normalizeEmail(field(req.body, 'email')) ?? ''}`,
  })
  const signupLimiter = rateLimit(limiterOptions())

  const router = Router()

  router.post('/auth/signup', signupLimiter, async (req, res) => {
    const input = parseSignUp(req.body)
    const passwordHash = await bcrypt.hash(input.password, rounds)
    let user
    try {
      user = await User.create({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
        ...(input.skills === undefined ? {} : { skills: input.skills }),
      })
    } catch (err) {
      if (isRecord(err) && err.code === 11000) {
        throw new HttpError(409, 'An account with that email already exists')
      }
      throw err
    }
    await signIn(req, user.id)
    respond<PublicUser>(res, 201, 'Account created', toPublicUser(user))
  })

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const input = parseSignIn(req.body)
    const user = await User.findOne({ email: input.email })
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? (await timingHash()))
    if (!user || !valid) throw new HttpError(401, INVALID_CREDENTIALS)
    await signIn(req, user.id)
    respond<PublicUser>(res, 200, 'Signed in', toPublicUser(user))
  })

  router.post('/auth/logout', async (req, res) => {
    await viaCallback((cb) => req.session.destroy(cb))
    res.clearCookie(SESSION_COOKIE, cookieOptions)
    res.status(204).end()
  })

  router.get('/auth/me', requireAuth, (req, res) => {
    respond<PublicUser>(res, 200, 'OK', toPublicUser(req.user!))
  })

  return router
}
