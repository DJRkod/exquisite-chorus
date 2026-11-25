// Typed fetch wrapper for the same-origin API (KTD2). Every response body is
// the server's { message, data } envelope; success resolves to data, failure
// rejects with an ApiError.
import type { VersionNode } from '../projects/types.ts'
import type {
  ApiEnvelope,
  ConfirmUploadRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  PlaybackUrlResponse,
  ProjectDto,
  PublicUser,
  RecordingDto,
  SignInRequest,
  SignUpRequest,
} from '@exquisite-chorus/shared'

export const DEFAULT_TIMEOUT_MS = 15_000
/** Render's free tier can take most of a minute to wake from a cold start. */
export const HEALTH_TIMEOUT_MS = 90_000

export type ApiErrorKind = 'http' | 'network' | 'timeout'

export class ApiError extends Error {
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number
  readonly kind: ApiErrorKind

  constructor(status: number, message: string, kind: ApiErrorKind) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.kind = kind
  }
}

export interface RequestOptions {
  timeoutMs?: number
}

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | undefined> {
  try {
    return (await response.json()) as ApiEnvelope<T>
  } catch {
    return undefined
  }
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const init: RequestInit = { method, credentials: 'same-origin', signal: controller.signal }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    clearTimeout(timer)
    if (controller.signal.aborted) {
      throw new ApiError(0, 'The server took too long to answer', 'timeout')
    }
    throw new ApiError(0, "Couldn't reach the server. Check your connection.", 'network')
  }

  try {
    if (response.status === 204) return undefined as T
    const envelope = await readEnvelope<T>(response)
    if (!response.ok) {
      const message = typeof envelope?.message === 'string' ? envelope.message : `Request failed (${response.status})`
      throw new ApiError(response.status, message, 'http')
    }
    return envelope?.data as T
  } finally {
    clearTimeout(timer)
  }
}

export interface Health {
  db: string
}

export const getHealth = () => request<Health>('GET', '/api/health', undefined, { timeoutMs: HEALTH_TIMEOUT_MS })
export const getMe = () => request<PublicUser>('GET', '/api/auth/me')
export const signUp = (input: SignUpRequest) => request<PublicUser>('POST', '/api/auth/signup', input)
export const signIn = (input: SignInRequest) => request<PublicUser>('POST', '/api/auth/login', input)
export const signOut = () => request<void>('POST', '/api/auth/logout')

const recordingPath = (id: string) => `/api/recordings/${encodeURIComponent(id)}`

export const listRecordings = () => request<RecordingDto[]>('GET', '/api/recordings')
export const createUpload = (input: CreateUploadRequest) =>
  request<CreateUploadResponse>('POST', '/api/recordings', input)
export const confirmUpload = (id: string, input: ConfirmUploadRequest) =>
  request<RecordingDto>('POST', `${recordingPath(id)}/confirm`, input)
export const getPlaybackUrl = (id: string) => request<PlaybackUrlResponse>('GET', `${recordingPath(id)}/playback-url`)

// Projects. The server routes are not built yet; these follow the paths
// shared/src/projects.ts anticipates, plus a proposed approval route.
const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`
const approvalPath = (id: string, version: number) => `${projectPath(id)}/contributions/${version}/approval`

export const getProject = (id: string) => request<ProjectDto>('GET', projectPath(id))
export const listVersions = (id: string) => request<VersionNode[]>('GET', `${projectPath(id)}/contributions`)
export const approveVersion = (id: string, version: number) => request<void>('PUT', approvalPath(id, version))
export const unapproveVersion = (id: string, version: number) => request<void>('DELETE', approvalPath(id, version))
