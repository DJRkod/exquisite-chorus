// Request guards: the signed-in user check for data routes, and the CSRF
// checks for state-changing API requests (KTD4).
import type { RequestHandler } from 'express'
import { HttpError, respond } from '../http.js'
import { User, type UserDocument } from './user.model.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: UserDocument
    }
  }
}

export const NOT_SIGNED_IN = 'Not signed in'

/** Loads the session's user onto req.user, or answers 401. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const userId = req.session?.userId
  const user = userId ? await User.findById(userId).select('-passwordHash') : null
  if (!user) throw new HttpError(401, NOT_SIGNED_IN)
  req.user = user
  next()
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Rejects state-changing requests whose Origin header names another site.
 * A missing Origin is allowed: browsers send it on cross-origin POSTs, so
 * its absence means a same-origin or non-browser client.
 */
export function originCheck(appOrigins: string[]): RequestHandler {
  const allowed = new Set(appOrigins)
  return (req, res, next) => {
    const origin = req.get('Origin')
    if (STATE_CHANGING.has(req.method) && origin !== undefined && !allowed.has(origin)) {
      respond(res, 403, 'Request origin not allowed')
      return
    }
    next()
  }
}

function hasBody(req: Parameters<RequestHandler>[0]): boolean {
  const length = req.get('Content-Length')
  return req.get('Transfer-Encoding') !== undefined || (length !== undefined && length !== '0')
}

/**
 * State-changing requests that carry a body must send JSON. HTML forms can
 * only send urlencoded, multipart or text/plain cross-site without a
 * preflight, so this closes that path. Bodiless requests (logout) pass.
 */
export const requireJsonBody: RequestHandler = (req, res, next) => {
  if (STATE_CHANGING.has(req.method) && hasBody(req) && !req.is('application/json')) {
    respond(res, 415, 'Request body must be application/json')
    return
  }
  next()
}
