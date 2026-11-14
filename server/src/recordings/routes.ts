// /api/recordings: presign an upload, confirm it against S3, list ready
// recordings, and issue playback URLs (KTD7–KTD9). Every route needs a session.
import { randomUUID } from 'node:crypto'
import type {
  CreateUploadRequest,
  CreateUploadResponse,
  PlaybackUrlResponse,
  RecordingDto,
} from '@exquisite-chorus/shared'
import { Router, type RequestHandler, type Response } from 'express'
import { Types } from 'mongoose'
import { requireAuth } from '../auth/guards.js'
import { User } from '../auth/user.model.js'
import { HttpError, respond } from '../http.js'
import { isMissingObject, MAX_UPLOAD_BYTES, type ObjectInfo, type Storage } from '../storage/s3.js'
import { Recording, toRecordingDto, type RecordingDocument } from './recording.model.js'

export const STORAGE_NOT_CONFIGURED = 'Audio storage is not configured'
export const CONTENT_TYPE_MAX = 100
export const DURATION_MAX_MS = 30 * 60 * 1000
export const LIST_LIMIT = 100

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined
}

function isAudioType(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('audio/') && value.length <= CONTENT_TYPE_MAX
}

function isValidSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_UPLOAD_BYTES
}

function parseCreateUpload(body: unknown): CreateUploadRequest {
  const contentType = field(body, 'contentType')
  const size = field(body, 'size')
  if (!isAudioType(contentType)) {
    throw new HttpError(400, `contentType must be an audio/ type of at most ${CONTENT_TYPE_MAX} characters`)
  }
  if (!isValidSize(size)) {
    throw new HttpError(400, `size must be a whole number of bytes from 1 to ${MAX_UPLOAD_BYTES}`)
  }
  return { contentType, size }
}

function parseDurationMs(body: unknown): number | undefined {
  const durationMs = field(body, 'durationMs')
  if (durationMs === undefined) return undefined
  if (!Number.isInteger(durationMs) || (durationMs as number) < 1 || (durationMs as number) > DURATION_MAX_MS) {
    throw new HttpError(400, `durationMs must be a whole number from 1 to ${DURATION_MAX_MS}`)
  }
  return durationMs as number
}

function parseId(raw: string | string[] | undefined): Types.ObjectId {
  if (typeof raw !== 'string' || !/^[0-9a-f]{24}$/i.test(raw)) {
    throw new HttpError(400, 'Invalid recording id')
  }
  return new Types.ObjectId(raw)
}

function isAcceptableObject(info: ObjectInfo): boolean {
  return isValidSize(info.size) && isAudioType(info.contentType)
}

function sendRecording(res: Response, rec: RecordingDocument): void {
  respond<RecordingDto>(res, 200, 'OK', toRecordingDto(rec))
}

/** Removing a pending object is best effort: the bucket's lifecycle rule expires `pending/`. */
async function deleteQuietly(storage: Storage, key: string): Promise<void> {
  try {
    await storage.deleteObject(key)
  } catch (err) {
    console.error(`Could not delete ${key}; the pending/ lifecycle rule will expire it.`, err)
  }
}

export function recordingsRouter(storage: Storage | null): Router {
  const requireStorage: RequestHandler = (_req, _res, next) => {
    if (!storage) throw new HttpError(503, STORAGE_NOT_CONFIGURED)
    next()
  }

  const router = Router()
  router.use('/recordings', requireAuth, requireStorage)

  router.post('/recordings', async (req, res) => {
    const input = parseCreateUpload(req.body)
    const owner = req.user!._id
    const pendingKey = `pending/${String(owner)}/${randomUUID()}`
    const rec = await Recording.create({ owner, status: 'pending', pendingKey, contentType: input.contentType })
    const { url, fields } = await storage!.presignUpload({ key: pendingKey, contentType: input.contentType })
    respond<CreateUploadResponse>(res, 201, 'Upload URL created', { recordingId: rec.id, url, fields })
  })

  router.post('/recordings/:id/confirm', async (req, res) => {
    const id = parseId(req.params.id)
    const durationMs = parseDurationMs(req.body)
    const owner = req.user!._id
    const rec = await Recording.findOne({ _id: id, owner })
    if (!rec) throw new HttpError(404, 'Recording not found')
    if (rec.status === 'ready') return sendRecording(res, rec)
    if (rec.status === 'rejected') throw new HttpError(422, 'This upload was rejected')

    const { pendingKey } = rec
    const key = `audio/${String(owner)}/${pendingKey.split('/').pop()}`

    // The pending object can be missing because it was never uploaded, or
    // because a concurrent confirm already promoted and deleted it.
    const onMissing = async (err: unknown): Promise<void> => {
      if (!isMissingObject(err)) throw err
      const current = await Recording.findOne({ _id: id, owner })
      if (current?.status === 'ready') return sendRecording(res, current)
      throw new HttpError(409, 'The upload has not reached storage yet')
    }

    let info: ObjectInfo
    try {
      info = await storage!.headObject(pendingKey)
    } catch (err) {
      return onMissing(err)
    }

    if (!isAcceptableObject(info)) {
      await Recording.updateOne({ _id: id, owner, status: 'pending' }, { status: 'rejected' })
      await deleteQuietly(storage!, pendingKey)
      throw new HttpError(422, 'Upload must be an audio file from 1 byte to 20 MB')
    }

    try {
      await storage!.promote(pendingKey, key)
    } catch (err) {
      return onMissing(err)
    }

    // Conditional on still pending, so a concurrent confirm cannot write twice.
    const ready = await Recording.findOneAndUpdate(
      { _id: id, owner, status: 'pending' },
      {
        status: 'ready',
        key,
        size: info.size,
        contentType: info.contentType,
        ...(durationMs === undefined ? {} : { durationMs }),
      },
      { returnDocument: 'after' },
    )
    if (!ready) {
      const current = await Recording.findOne({ _id: id, owner })
      if (current?.status === 'ready') return sendRecording(res, current)
      throw new HttpError(409, 'The recording changed during confirmation; try again')
    }

    await deleteQuietly(storage!, pendingKey)
    sendRecording(res, ready)
  })

  router.get('/recordings', async (_req, res) => {
    const recs = await Recording.find({ status: 'ready' })
      .sort({ createdAt: -1, _id: -1 })
      .limit(LIST_LIMIT)
      .lean()
    const ownerIds = [...new Set(recs.map((rec) => String(rec.owner)))]
    const owners = await User.find({ _id: { $in: ownerIds } }, { displayName: 1 }).lean()
    const names = new Map(owners.map((user) => [String(user._id), user.displayName]))
    const data = recs.map((rec) => toRecordingDto(rec, names.get(String(rec.owner)) ?? ''))
    respond<RecordingDto[]>(res, 200, 'OK', data)
  })

  router.get('/recordings/:id/playback-url', async (req, res) => {
    const id = parseId(req.params.id)
    const rec = await Recording.findOne({ _id: id, status: 'ready' })
    if (!rec?.key) throw new HttpError(404, 'Recording not found')
    respond<PlaybackUrlResponse>(res, 200, 'OK', await storage!.presignPlayback(rec.key))
  })

  return router
}
