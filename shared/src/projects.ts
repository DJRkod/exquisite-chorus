// Project and contribution request/response shapes for the
// /api/projects/* endpoints, agreed before the routes are built (see
// team-roles.md: both pairs agree on the model and vocabulary first).
import type { Skill } from './vocabulary.js'

export type ProjectStatus = 'open' | 'closed'

/** A project as the API returns it. Tags are null when the owner left them out. */
export interface ProjectDto {
  id: string
  ownerId: string
  /** Present in feed and list responses. */
  ownerDisplayName?: string
  title: string
  description: string | null
  /** Whole beats per minute, e.g. 92. */
  bpm: number | null
  /** e.g. 'G major'. */
  musicalKey: string | null
  genre: string | null
  mood: string | null
  /** What kinds of contribution the project is asking for. */
  needs: Skill[]
  status: ProjectStatus
  /** Version of the current mix; 1 is the owner's original track. */
  currentVersion: number
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601; the last contribution, so feeds can sort by activity. */
  updatedAt: string
}

/** One entry in a project's version history. */
export interface ContributionDto {
  id: string
  projectId: string
  contributorId: string
  /** Present in list responses. */
  contributorDisplayName?: string
  /** 1 is the owner's original track. */
  version: number
  /** What changed, e.g. 'Added brushed drums'. */
  note: string | null
  /** The recording behind this version, once the upload is confirmed. */
  recordingId: string | null
  /** ISO 8601. */
  createdAt: string
}

/** POST /api/projects body. Every tag is optional (README: "all optional"). */
export interface CreateProjectRequest {
  title: string
  /** ID returned by the recording upload and confirmation flow. */
  recordingId?: string
  description?: string
  bpm?: number
  musicalKey?: string
  genre?: string
  mood?: string
  /** At least one: the project must say what it needs. */
  needs: Skill[]
}

/** POST /api/projects/:id/contributions body. */
export interface CreateContributionRequest {
  note?: string
  recordingId?: string
  /** Version the contributor listened to; send to detect stale mixes. */
  baseVersion?: number
  /** Skills requested for the next version; omit to keep the existing needs. */
  needs?: Skill[]
}

/** PATCH /api/projects/:id: omit unchanged fields; null clears optional tags. */
export interface UpdateProjectRequest {
  title?: string
  description?: string | null
  bpm?: number | null
  musicalKey?: string | null
  genre?: string | null
  mood?: string | null
  needs?: Skill[]
  status?: ProjectStatus
}

/** GET /api/tags: choices from the same vocabulary used by the models. */
export interface TagOptionsDto {
  skills: Skill[]
  genres: string[]
  moods: string[]
  musicalKeys: string[]
  bpmMin: number
  bpmMax: number
}
