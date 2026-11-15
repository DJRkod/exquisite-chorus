// Recording request and response shapes for /api/recordings/*.

export type RecordingStatus = 'pending' | 'ready' | 'rejected'

/** A recording as the API returns it. Never carries S3 object keys. */
export interface RecordingDto {
  id: string
  ownerId: string
  /** Present in list responses. */
  ownerDisplayName?: string
  status: RecordingStatus
  /** MIME type as recorded, e.g. `audio/webm;codecs=opus`. */
  contentType: string
  /** Bytes; known once the upload is confirmed. */
  size: number | null
  durationMs: number | null
  /** ISO 8601. */
  createdAt: string
}

/** POST /api/recordings body. */
export interface CreateUploadRequest {
  contentType: string
  size: number
}

/** POST /api/recordings response: a presigned POST valid for 5 minutes. */
export interface CreateUploadResponse {
  recordingId: string
  url: string
  /** Form fields to send, in order, before the file field. */
  fields: Record<string, string>
}

/** POST /api/recordings/:id/confirm body. */
export interface ConfirmUploadRequest {
  durationMs?: number
}

/** GET /api/recordings/:id/playback-url response. */
export interface PlaybackUrlResponse {
  url: string
  /** ISO 8601. */
  expiresAt: string
}
