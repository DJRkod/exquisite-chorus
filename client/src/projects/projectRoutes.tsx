// The two ways into the project page: a real project from the API, and the
// demo, which needs no server or sign-in.
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { approveVersion, getPlaybackUrl, getProject, listVersions, unapproveVersion } from '../api/client.ts'
import { useAuth } from '../auth/useAuth.ts'
import { DEMO_OWNER_ID, DEMO_PROJECT } from './demoProject.ts'
import ProjectPage from './ProjectPage.tsx'
import type { ProjectSource } from './types.ts'

export function ApiProjectRoute() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const viewerId = user?.id ?? null
  const source = useMemo<ProjectSource>(
    () => ({
      viewerId,
      load: async () => {
        const [project, versions] = await Promise.all([getProject(id), listVersions(id)])
        return { project, versions }
      },
      setApproved: (version, approved) => (approved ? approveVersion(id, version) : unapproveVersion(id, version)),
      recordingUrl: async (recordingId) => (await getPlaybackUrl(recordingId)).url,
    }),
    [id, viewerId],
  )
  return <ProjectPage key={id} source={source} />
}

export function DemoProjectRoute() {
  const source = useMemo<ProjectSource>(
    () => ({
      viewerId: DEMO_OWNER_ID,
      demoLabel: 'Demo project with made-up data. You are viewing as the owner; nothing is saved.',
      load: async () => structuredClone(DEMO_PROJECT),
      setApproved: async () => {},
      recordingUrl: async () => {
        throw new Error('The demo has no recordings')
      },
    }),
    [],
  )
  return (
    <>
      <header className="app-header">
        <span className="app-name">Exquisite Chorus</span>
        <Link to="/">Sign in</Link>
      </header>
      <ProjectPage source={source} />
    </>
  )
}
