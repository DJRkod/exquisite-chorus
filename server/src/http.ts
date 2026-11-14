// The response envelope, an error type that carries an HTTP status, and the
// central error middleware. Ported from MP3's routes/helpers.js and
// routes/index.js; Express 5 forwards async rejections, so no wrap() helper.
import type { ApiEnvelope } from '@exquisite-chorus/shared'
import type { ErrorRequestHandler, RequestHandler, Response } from 'express'
import mongoose from 'mongoose'

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function respond<T>(res: Response, status: number, message: string, data?: T): void {
  const body: ApiEnvelope<T | null> = { message, data: data === undefined ? null : data }
  res.status(status).json(body)
}

/** Unknown endpoint under /api. */
export const apiNotFound: RequestHandler = (_req, res) => {
  respond(res, 404, 'Endpoint not found')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Reads one property of an untrusted request body; undefined unless the body is an object. */
export function field(body: unknown, name: string): unknown {
  return isRecord(body) ? body[name] : undefined
}

/** Every error becomes the JSON envelope; nothing internal reaches the client. */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err instanceof HttpError) {
    respond(res, err.status, err.message)
    return
  }
  if (isRecord(err) && err.type === 'entity.parse.failed') {
    respond(res, 400, 'Request body is not valid JSON')
    return
  }
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    respond(res, 400, 'Invalid field value')
    return
  }
  if (isRecord(err) && err.code === 11000) {
    respond(res, 409, 'A record with that value already exists')
    return
  }
  // body-parser errors other than bad JSON (e.g. payload too large) carry a 4xx status.
  if (isRecord(err) && err.expose === true && typeof err.status === 'number' && err.status < 500) {
    respond(res, err.status, typeof err.message === 'string' ? err.message : 'Bad request')
    return
  }
  console.error(err)
  respond(res, 500, 'Something went wrong on the server')
}
