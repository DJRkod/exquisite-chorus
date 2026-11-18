// User accounts. Email uniqueness is a real unique index (KTD13), and JSON
// serialization never includes the password hash. `skills` lists what the user
// plays or does, from the shared vocabulary; the feed matches it against
// project needs.
import type { PublicUser, Skill } from '@exquisite-chorus/shared'
import { SKILLS } from '@exquisite-chorus/shared/vocabulary'
import { model, Schema, type HydratedDocument } from 'mongoose'

export const DISPLAY_NAME_MAX = 50

export interface UserFields {
  email: string
  displayName: string
  passwordHash: string
  skills: Skill[]
}

const userSchema = new Schema<UserFields>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: DISPLAY_NAME_MAX },
    passwordHash: { type: String, required: true },
    skills: { type: [String], enum: [...SKILLS], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret): PublicUser => ({
        id: String(ret._id),
        email: ret.email,
        displayName: ret.displayName,
        // `?? []` covers documents created before the field existed.
        skills: ret.skills ?? [],
      }),
    },
  },
)

export const User = model<UserFields>('User', userSchema)

export type UserDocument = HydratedDocument<UserFields>

export function toPublicUser(user: UserDocument): PublicUser {
  return user.toJSON() as unknown as PublicUser
}
