// /api/projects: create and browse musical projects and retrieve details.
// Every route requires a signed-in user. Recordings are uploaded and confirmed
// through /api/recordings before they can be attached to a version.
import type { ContributionDto, CreateContributionRequest, CreateProjectRequest, ProjectDto, Skill, TagOptionsDto, UpdateProjectRequest } from '@exquisite-chorus/shared'
import { GENRES, MOODS, MUSICAL_KEYS, SKILLS } from '@exquisite-chorus/shared/vocabulary'
import { Router } from 'express'
import { Types, type QueryFilter } from 'mongoose'
import { requireAuth } from '../auth/guards.js'
import { User } from '../auth/user.model.js'
import { field, HttpError, isRecord, respond } from '../http.js'
import { Contribution, NOTE_MAX, ORIGINAL_TRACK_NOTE, toContributionDto } from '../models/contribution.model.js'
import {
  BPM_MAX,
  BPM_MIN,
  DESCRIPTION_MAX,
  Project,
  type ProjectFields,
  TITLE_MAX,
  toProjectDto,
} from '../models/project.model.js'
import { Recording } from '../recordings/recording.model.js'

const LIST_LIMIT = 50

function optionalText(body: unknown, name: string, max: number): string | undefined {
  const value = field(body, name)
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new HttpError(400, `${name} must be text of at most ${max} characters`)
  }
  return value.trim()
}

function optionalTag(body: unknown, name: string, allowed: readonly string[]): string | undefined {
  const value = field(body, name)
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new HttpError(400, `${name} must be selected from the available options`)
  }
  return value
}

function parseCreateProject(body: unknown): CreateProjectRequest {
  const rawTitle = field(body, 'title')
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (title.length < 1 || title.length > TITLE_MAX) {
    throw new HttpError(400, `Title must be 1 to ${TITLE_MAX} characters`)
  }

  const needs = parseNeeds(field(body, 'needs'))
  const recordingId = optionalRecordingId(body)
  const description = optionalText(body, 'description', DESCRIPTION_MAX)
  const musicalKey = optionalTag(body, 'musicalKey', MUSICAL_KEYS)
  const genre = optionalTag(body, 'genre', GENRES)
  const mood = optionalTag(body, 'mood', MOODS)

  const bpm = field(body, 'bpm')
  if (bpm !== undefined && (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < BPM_MIN || bpm > BPM_MAX)) {
    throw new HttpError(400, `BPM must be a whole number between ${BPM_MIN} and ${BPM_MAX}`)
  }
  return {
    title,
    needs,
    ...(recordingId === undefined ? {} : { recordingId }),
    ...(description === undefined ? {} : { description }),
    ...(bpm === undefined ? {} : { bpm: bpm as number }),
    ...(musicalKey === undefined ? {} : { musicalKey }),
    ...(genre === undefined ? {} : { genre }),
    ...(mood === undefined ? {} : { mood }),
  }
}

function parseNeeds(value: unknown): Skill[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((need) => typeof need !== 'string' || !(SKILLS as readonly string[]).includes(need))) {
    throw new HttpError(400, 'Needs must contain at least one skill from the skill picker')
  }
  return [...new Set(value)] as Skill[]
}

function optionalRecordingId(body: unknown): string | undefined {
  const value = field(body, 'recordingId')
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw new HttpError(400, 'Invalid recording id')
  }
  return value
}

function parseContribution(body: unknown): CreateContributionRequest {
  const note = optionalText(body, 'note', NOTE_MAX)
  const recordingId = optionalRecordingId(body)
  if (!note && !recordingId) throw new HttpError(400, 'Upload a recording or provide a contribution note')
  const baseVersion = field(body, 'baseVersion')
  if (baseVersion !== undefined && (typeof baseVersion !== 'number' || !Number.isSafeInteger(baseVersion) || baseVersion < 1)) {
    throw new HttpError(400, 'baseVersion must be a positive whole number')
  }
  const rawNeeds = field(body, 'needs')
  return {
    ...(note ? { note } : {}),
    ...(recordingId === undefined ? {} : { recordingId }),
    ...(baseVersion === undefined ? {} : { baseVersion: baseVersion as number }),
    ...(rawNeeds === undefined ? {} : { needs: parseNeeds(rawNeeds) }),
  }
}

// Atomically claim a ready recording. A user can only attach their own
// confirmed audio, and a recording can belong to only one submitted version.
async function claimRecording(id: string, owner: Types.ObjectId, project: Types.ObjectId): Promise<Types.ObjectId> {
  const owned = await Recording.findOne({ _id: id, owner }).lean()
  if (!owned) throw new HttpError(404, 'Recording not found')
  if (owned.status !== 'ready' || !owned.key) throw new HttpError(409, 'Confirm the audio upload before submitting it')
  const claimed = await Recording.findOneAndUpdate(
    { _id: id, owner, status: 'ready', project: { $exists: false } },
    { $set: { project } },
    { returnDocument: 'after' },
  )
  if (!claimed) throw new HttpError(409, 'Recording already attached to a project')
  return claimed._id
}

async function releaseRecording(id: Types.ObjectId, project: Types.ObjectId): Promise<void> {
  await Recording.updateOne({ _id: id, project }, { $unset: { project: 1 } })
}

function flag(value: unknown, name: string): boolean {
  if (value === undefined || value === 'false') return false
  if (value === 'true') return true
  throw new HttpError(400, `${name} must be true or false`)
}

// PATCH accepts only editable fields. Null clears optional metadata, while
// absent fields retain their previous values.
function parseProjectUpdate(body: unknown): UpdateProjectRequest {
  const allowed = ['title', 'description', 'bpm', 'musicalKey', 'genre', 'mood', 'needs', 'status']
  if (!isRecord(body) || Array.isArray(body) || Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, 'Provide one or more editable project fields')
  }
  const input: UpdateProjectRequest = {}
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title.length < 1 || title.length > TITLE_MAX) throw new HttpError(400, `Title must be 1 to ${TITLE_MAX} characters`)
    input.title = title
  }
  if (body.description !== undefined) input.description = body.description === null ? null : optionalText(body, 'description', DESCRIPTION_MAX)!
  if (body.bpm !== undefined) {
    const bpm = body.bpm
    if (bpm !== null && (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < BPM_MIN || bpm > BPM_MAX)) {
      throw new HttpError(400, `BPM must be a whole number between ${BPM_MIN} and ${BPM_MAX}`)
    }
    input.bpm = bpm
  }
  if (body.musicalKey !== undefined) input.musicalKey = body.musicalKey === null ? null : optionalTag(body, 'musicalKey', MUSICAL_KEYS)!
  if (body.genre !== undefined) input.genre = body.genre === null ? null : optionalTag(body, 'genre', GENRES)!
  if (body.mood !== undefined) input.mood = body.mood === null ? null : optionalTag(body, 'mood', MOODS)!
  if (body.needs !== undefined) input.needs = parseNeeds(body.needs)
  if (body.status !== undefined) {
    if (body.status !== 'open' && body.status !== 'closed') throw new HttpError(400, 'Status must be open or closed')
    input.status = body.status
  }
  return input
}

function projectId(raw: string | string[] | undefined): Types.ObjectId {
  if (typeof raw !== 'string' || !/^[a-f\d]{24}$/i.test(raw)) {
    throw new HttpError(400, 'Invalid project id')
  }
  return new Types.ObjectId(raw)
}

export function projectsRouter(): Router {
  const router = Router()
  router.use('/projects', requireAuth)

  // Static vocabulary is public so the signup picker can also use it.
  router.get('/tags', (_req, res) => {
    respond<TagOptionsDto>(res, 200, 'OK', {
      skills: [...SKILLS], genres: [...GENRES], moods: [...MOODS], musicalKeys: [...MUSICAL_KEYS],
      bpmMin: BPM_MIN, bpmMax: BPM_MAX,
    })
  })

  router.post('/projects', async (req, res) => {
    const { recordingId, ...input } = parseCreateProject(req.body)
    const owner = req.user!._id
    const project = new Project({ ...input, owner })
    let recording: Types.ObjectId | undefined
    try {
      if (recordingId) recording = await claimRecording(recordingId, owner, project._id)
      await Contribution.create({
        project: project._id,
        contributor: owner,
        version: 1,
        note: ORIGINAL_TRACK_NOTE,
        ...(recording ? { recording } : {}),
      })
      await project.save()
    } catch (err) {
      // Compensate if any write fails; the current test DB is standalone.
      await Project.deleteOne({ _id: project._id })
      await Contribution.deleteMany({ project: project._id })
      if (recording) await releaseRecording(recording, project._id)
      throw err
    }
    respond<ProjectDto>(res, 201, 'Project created', toProjectDto(project, req.user!.displayName))
  })

  router.get('/projects', async (req, res) => {
    const matched = flag(req.query.matched, 'matched')
    const mine = flag(req.query.mine, 'mine')
    if (matched && mine) throw new HttpError(400, 'Choose either matched or mine')

    // General browsing and skill-matched feeds show only open projects.
    // The mine filter also includes closed projects in the owner's dashboard.
    const filter: QueryFilter<ProjectFields> = mine
      ? { owner: req.user!._id }
      : matched
        ? { status: 'open', needs: { $in: req.user!.skills }, owner: { $ne: req.user!._id } }
        : { status: 'open' }
    const genre = optionalTag(req.query, 'genre', GENRES)
    const mood = optionalTag(req.query, 'mood', MOODS)
    const musicalKey = optionalTag(req.query, 'musicalKey', MUSICAL_KEYS)
    const rawNeed = req.query.need
    if (genre !== undefined) filter.genre = genre
    if (mood !== undefined) filter.mood = mood
    if (musicalKey !== undefined) filter.musicalKey = musicalKey
    if (rawNeed !== undefined) {
      // Keep the matched filter as well: the requested skill must be present
      // AND at least one of the signed-in user's skills must be present.
      filter.$and = [{ needs: { $in: parseNeeds([rawNeed]) } }]
    }
    const rawBpm = req.query.bpm
    if (rawBpm !== undefined) {
      if (typeof rawBpm !== 'string' || !/^\d+$/.test(rawBpm) || Number(rawBpm) < BPM_MIN || Number(rawBpm) > BPM_MAX) {
        throw new HttpError(400, `BPM must be a whole number between ${BPM_MIN} and ${BPM_MAX}`)
      }
      filter.bpm = Number(rawBpm)
    }
    const projects = await Project.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(LIST_LIMIT)
      .lean()
    const ownerIds = [...new Set(projects.map((project) => String(project.owner)))]
    const owners = await User.find({ _id: { $in: ownerIds } }, { displayName: 1 }).lean()
    const names = new Map(owners.map((user) => [String(user._id), user.displayName]))
    respond<ProjectDto[]>(res, 200, 'OK', projects.map((project) => toProjectDto(project, names.get(String(project.owner)))))
  })

  router.get('/projects/:id', async (req, res) => {
    const id = projectId(req.params.id)
    const project = await Project.findById(id).lean()
    if (!project) throw new HttpError(404, 'Project not found')
    const owner = await User.findById(project.owner, { displayName: 1 }).lean()
    respond<ProjectDto>(res, 200, 'OK', toProjectDto(project, owner?.displayName))
  })

  router.patch('/projects/:id', async (req, res) => {
    const id = projectId(req.params.id)
    const input = parseProjectUpdate(req.body)
    const owner = req.user!._id
    const existing = await Project.findById(id, { owner: 1 }).lean()
    if (!existing) throw new HttpError(404, 'Project not found')
    if (!existing.owner.equals(owner)) throw new HttpError(403, 'Only the project owner can edit this project')

    // Allow optional tags to be cleared without storing null in the schema.
    const set = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null))
    const unset = Object.fromEntries(Object.entries(input).filter(([, value]) => value === null).map(([key]) => [key, 1]))
    const project = await Project.findOneAndUpdate(
      { _id: id, owner },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: 'after', runValidators: true },
    )
    if (!project) throw new HttpError(404, 'Project not found')
    respond<ProjectDto>(res, 200, 'Project updated', toProjectDto(project, req.user!.displayName))
  })

  router.get('/projects/:id/contributions', async (req, res) => {
    const id = projectId(req.params.id)
    const project = await Project.findById(id).lean()
    if (!project) throw new HttpError(404, 'Project not found')
    // Only versions published by the project update are visible.
    const versions = await Contribution.find({ project: id, version: { $lte: project.currentVersion } })
      .sort({ version: -1 })
      .lean()
    const contributorIds = [...new Set(versions.map((version) => String(version.contributor)))]
    const users = await User.find({ _id: { $in: contributorIds } }, { displayName: 1 }).lean()
    const names = new Map(users.map((user) => [String(user._id), user.displayName]))
    respond<ContributionDto[]>(res, 200, 'OK', versions.map((version) => toContributionDto(version, names.get(String(version.contributor)))))
  })

  router.post('/projects/:id/contributions', async (req, res) => {
    const id = projectId(req.params.id)
    const input = parseContribution(req.body)
    const contributor = req.user!._id
    const project = await Project.findById(id).lean()
    if (!project) throw new HttpError(404, 'Project not found')
    if (project.status !== 'open') throw new HttpError(409, 'This project is closed')
    if (input.baseVersion !== undefined && input.baseVersion !== project.currentVersion) {
      throw new HttpError(409, 'A newer version is available; refresh the project before contributing')
    }

    // The unique project/version index prevents simultaneous submissions from
    // creating duplicate versions. The conditional update also checks that
    // the project is still open and still at the version we read.
    const contribution = new Contribution({
      project: id,
      contributor,
      version: project.currentVersion + 1,
      ...(input.note ? { note: input.note } : {}),
    })
    let recording: Types.ObjectId | undefined
    let saved = false
    try {
      if (input.recordingId) {
        recording = await claimRecording(input.recordingId, contributor, id)
        contribution.recording = recording
      }
      await contribution.save()
      saved = true
      const updated = await Project.updateOne(
        { _id: id, status: 'open', currentVersion: project.currentVersion },
        { $inc: { currentVersion: 1 }, ...(input.needs ? { $set: { needs: input.needs } } : {}) },
        { runValidators: true },
      )
      if (updated.modifiedCount !== 1) throw new HttpError(409, 'Project changed; refresh before contributing')
    } catch (err) {
      if (saved) await Contribution.deleteOne({ _id: contribution._id })
      if (recording) await releaseRecording(recording, id)
      throw err
    }
    respond<ContributionDto>(res, 201, 'Contribution created', toContributionDto(contribution, req.user!.displayName))
  })

  return router
}
