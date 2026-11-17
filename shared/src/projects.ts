// Project and contribution request/response shapes for the future
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
}
