// A project: an unfinished musical idea the owner wants others to add to.
// Structure follows the clickable prototype's demo content (prototype/README.md):
// an owner, optional tags (BPM, key, genre, mood), and the kinds of
// contribution it needs, matched against the shared vocabulary.
//
// The feed lists open projects a signed-in user's skills match, most recently
// active first, so the compound index below sorts on updatedAt.
import type { ProjectDto, ProjectStatus, Skill } from '@exquisite-chorus/shared'
import { GENRES, MOODS, MUSICAL_KEYS, SKILLS } from '@exquisite-chorus/shared/vocabulary'
import { model, Schema, type HydratedDocument, type Types } from 'mongoose'

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['open', 'closed']
export const TITLE_MAX = 140
export const DESCRIPTION_MAX = 2000
/** Whole beats per minute: slowest ballad to fastest punk/hardcore. */
export const BPM_MIN = 20
export const BPM_MAX = 400

export interface ProjectFields {
  owner: Types.ObjectId
  title: string
  description?: string
  bpm?: number
  /** Note + mode, e.g. 'G major'. Named musicalKey to not collide with the Keys instrument. */
  musicalKey?: string
  genre?: string
  mood?: string
  /** Skills the project is asking for; drives the skills-matched feed. */
  needs: Skill[]
  status: ProjectStatus
  /** Version of the current mix; 1 until the first contribution lands. */
  currentVersion: number
  createdAt: Date
  updatedAt: Date
}

const projectSchema = new Schema<ProjectFields>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: TITLE_MAX },
    description: { type: String, trim: true, maxlength: DESCRIPTION_MAX },
    bpm: {
      type: Number,
      min: BPM_MIN,
      max: BPM_MAX,
      validate: {
        validator: (v: number) => Number.isInteger(v),
        message: 'BPM must be a whole number',
      },
    },
    musicalKey: { type: String, enum: [...MUSICAL_KEYS] },
    genre: { type: String, enum: [...GENRES] },
    mood: { type: String, enum: [...MOODS] },
    needs: {
      type: [String],
      enum: [...SKILLS],
      required: true,
      validate: {
        validator: (needs: string[]) => needs.length > 0,
        message: 'A project needs at least one kind of contribution',
      },
    },
    status: { type: String, enum: PROJECT_STATUSES, required: true, default: 'open' },
    currentVersion: { type: Number, required: true, default: 1 },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret): ProjectDto =>
        toProjectDto(ret as unknown as ProjectFields & { _id: unknown }),
    },
  },
)

// The feed: open projects by most recent activity. Routes tie-break with
// { _id: -1 }, the recordings list convention, for a stable order.
projectSchema.index({ status: 1, updatedAt: -1 })

export const Project = model<ProjectFields>('Project', projectSchema)

export type ProjectDocument = HydratedDocument<ProjectFields>

/** The client-facing shape, from a document or a lean object. */
export function toProjectDto(
  project: Pick<
    ProjectFields,
    | 'owner'
    | 'title'
    | 'description'
    | 'bpm'
    | 'musicalKey'
    | 'genre'
    | 'mood'
    | 'needs'
    | 'status'
    | 'currentVersion'
    | 'createdAt'
    | 'updatedAt'
  > & { _id: unknown },
  ownerDisplayName?: string,
): ProjectDto {
  return {
    id: String(project._id),
    ownerId: String(project.owner),
    ...(ownerDisplayName === undefined ? {} : { ownerDisplayName }),
    title: project.title,
    description: project.description ?? null,
    bpm: project.bpm ?? null,
    musicalKey: project.musicalKey ?? null,
    genre: project.genre ?? null,
    mood: project.mood ?? null,
    needs: project.needs,
    status: project.status,
    currentVersion: project.currentVersion,
    createdAt: new Date(project.createdAt).toISOString(),
    updatedAt: new Date(project.updatedAt).toISOString(),
  }
}
