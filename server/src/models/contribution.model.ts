// One version of a project's mix. Version 1 is the owner's original track,
// created together with the project; every later version is a contribution
// someone submitted ("pass an amended track on to new contributors"). The
// version history the project page shows is these documents, newest first.
//
// `recording` stays optional: the recording endpoints (upload/confirm) already
// exist, and a contribution links to one once that wiring is built; a lyrics
// contribution may carry only a note.
import type { ContributionDto } from '@exquisite-chorus/shared'
import { model, Schema, type HydratedDocument, type Types } from 'mongoose'

export const NOTE_MAX = 500
export const ORIGINAL_TRACK_NOTE = 'Original track'

export interface ContributionFields {
  project: Types.ObjectId
  contributor: Types.ObjectId
  /** 1 = the owner's original track; one document per version. */
  version: number
  /** What changed in this version, e.g. 'Added brushed drums'. */
  note?: string
  /** The Recording behind this version, once an upload is attached. */
  recording?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const contributionSchema = new Schema<ContributionFields>(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    contributor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, required: true, min: 1 },
    note: { type: String, trim: true, maxlength: NOTE_MAX },
    recording: { type: Schema.Types.ObjectId, ref: 'Recording' },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret): ContributionDto =>
        toContributionDto(ret as unknown as ContributionFields & { _id: unknown }),
    },
  },
)

// A real unique index (KTD13): a project can hold each version number once,
// so concurrent submissions cannot create two v2s.
contributionSchema.index({ project: 1, version: 1 }, { unique: true })

export const Contribution = model<ContributionFields>('Contribution', contributionSchema)

export type ContributionDocument = HydratedDocument<ContributionFields>

/** The client-facing shape, from a document or a lean object. */
export function toContributionDto(
  contribution: Pick<ContributionFields, 'project' | 'contributor' | 'version' | 'note' | 'recording' | 'createdAt'> & {
    _id: unknown
  },
  contributorDisplayName?: string,
): ContributionDto {
  return {
    id: String(contribution._id),
    projectId: String(contribution.project),
    contributorId: String(contribution.contributor),
    ...(contributorDisplayName === undefined ? {} : { contributorDisplayName }),
    version: contribution.version,
    note: contribution.note ?? null,
    recordingId: contribution.recording ? String(contribution.recording) : null,
    createdAt: new Date(contribution.createdAt).toISOString(),
  }
}
