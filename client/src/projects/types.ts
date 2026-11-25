// The project page's view of a version. The server's ContributionDto has no
// parent or approval yet; these optional fields are the contract the client
// proposes for /api/projects/:id/contributions. Until they arrive, a version
// with no parent is treated as built on the one numbered below it.
import type { ContributionDto, ProjectDto, Skill } from '@exquisite-chorus/shared'

export interface VersionNode extends ContributionDto {
  /** The version this one was built on; null or absent for "the one before". */
  parentVersion?: number | null
  /** Whether the project owner has approved this version. */
  approved?: boolean
  /** What this version added, e.g. ['Bass']. */
  skillsAdded?: Skill[]
}

export interface ProjectData {
  project: ProjectDto
  versions: VersionNode[]
}

/** Where the page gets its data and sends approvals: the real API or the demo. */
export interface ProjectSource {
  /** The signed-in user (or the demo viewer); owner controls show when it matches project.ownerId. */
  viewerId: string | null
  /** Label shown above the page when the data is not real. */
  demoLabel?: string
  load: (signal: AbortSignal) => Promise<ProjectData>
  setApproved: (version: number, approved: boolean) => Promise<void>
  /** A playable/downloadable URL for a recording. */
  recordingUrl: (recordingId: string) => Promise<string>
}
