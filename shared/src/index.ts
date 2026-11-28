// API payload types shared by client and server.
// Types only: this package has no build step and no runtime code, so consumers
// must use `import type { ... } from '@exquisite-chorus/shared'`.

/** Every API response body has this shape. */
export interface ApiEnvelope<T> {
  message: string
  data: T
}

export type { PublicUser, SignInRequest, SignUpRequest } from './auth.js'
export type {
  ConfirmUploadRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  PlaybackUrlResponse,
  RecordingDto,
  RecordingStatus,
} from './recordings.js'
export type {
  ContributionDto,
  CreateContributionRequest,
  CreateProjectRequest,
  ProjectDto,
  ProjectStatus,
  TagOptionsDto,
  UpdateProjectRequest,
} from './projects.js'
// The vocabulary's runtime lists (SKILLS, GENRES, ...) are NOT re-exported
// here: the root entry stays types-only. Import values from
// '@exquisite-chorus/shared/vocabulary' instead.
export type { Genre, Mood, MusicalKey, Skill } from './vocabulary.js'
