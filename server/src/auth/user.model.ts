// User accounts. Email uniqueness is a real unique index (KTD13), and JSON
// serialization never includes the password hash.
import type { PublicUser } from '@exquisite-chorus/shared'
import { model, Schema, type HydratedDocument } from 'mongoose'

export const DISPLAY_NAME_MAX = 50

export interface UserFields {
  email: string
  displayName: string
  passwordHash: string
}

const userSchema = new Schema<UserFields>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: DISPLAY_NAME_MAX },
    passwordHash: { type: String, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret): PublicUser => ({
        id: String(ret._id),
        email: ret.email,
        displayName: ret.displayName,
      }),
    },
  },
)

export const User = model<UserFields>('User', userSchema)

export type UserDocument = HydratedDocument<UserFields>

export function toPublicUser(user: UserDocument): PublicUser {
  return user.toJSON() as unknown as PublicUser
}
