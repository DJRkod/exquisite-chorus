// Recording metadata (R3): the audio itself lives only in S3. A recording is
// `pending` from presign until confirm promotes its object to `audio/` (KTD8).
// JSON serialization never includes S3 keys.
import type { RecordingDto, RecordingStatus } from '@exquisite-chorus/shared'
import { model, Schema, type HydratedDocument, type Types } from 'mongoose'

export const RECORDING_STATUSES: readonly RecordingStatus[] = ['pending', 'ready', 'rejected']

export interface RecordingFields {
  owner: Types.ObjectId
  status: RecordingStatus
  /** `pending/{userId}/{uuid}`: where the browser uploads. */
  pendingKey: string
  /** `audio/{userId}/{uuid}`: set when the recording becomes ready. */
  key?: string
  contentType: string
  size?: number
  durationMs?: number
  /** Unused until projects exist. */
  project?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const recordingSchema = new Schema<RecordingFields>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: RECORDING_STATUSES, required: true, default: 'pending' },
    pendingKey: { type: String, required: true },
    key: { type: String, unique: true, sparse: true },
    contentType: { type: String, required: true },
    size: { type: Number },
    durationMs: { type: Number },
    project: { type: Schema.Types.ObjectId },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret): RecordingDto => toRecordingDto(ret as unknown as RecordingFields & { _id: unknown }),
    },
  },
)

recordingSchema.index({ status: 1, createdAt: -1 })

export const Recording = model<RecordingFields>('Recording', recordingSchema)

export type RecordingDocument = HydratedDocument<RecordingFields>

/** The client-facing shape, from a document or a lean object. */
export function toRecordingDto(
  rec: Pick<RecordingFields, 'owner' | 'status' | 'contentType' | 'size' | 'durationMs' | 'createdAt'> & {
    _id: unknown
  },
  ownerDisplayName?: string,
): RecordingDto {
  return {
    id: String(rec._id),
    ownerId: String(rec.owner),
    ...(ownerDisplayName === undefined ? {} : { ownerDisplayName }),
    status: rec.status,
    contentType: rec.contentType,
    size: rec.size ?? null,
    durationMs: rec.durationMs ?? null,
    createdAt: new Date(rec.createdAt).toISOString(),
  }
}
