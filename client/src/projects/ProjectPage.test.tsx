import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { envelope, type Routes } from '../test/fakeApi.ts'
import { renderApp } from '../test/renderApp.tsx'

const MAYA = { id: 'u-maya', email: 'maya@example.com', displayName: 'Maya Okafor', skills: [] }
const RILEY = { id: 'u-riley', email: 'riley@example.com', displayName: 'Riley Chen', skills: [] }

const PROJECT = {
  id: 'p1',
  ownerId: 'u-maya',
  ownerDisplayName: 'Maya Okafor',
  title: 'Porch Song',
  description: null,
  bpm: 84,
  musicalKey: 'G major',
  genre: null,
  mood: 'Mellow',
  needs: ['Bass', 'Drums'],
  status: 'open',
  currentVersion: 9,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
}

function ver(version: number, parentVersion: number | null, extra: Record<string, unknown> = {}) {
  return {
    id: `c${version}`,
    projectId: 'p1',
    contributorId: `u${version}`,
    contributorDisplayName: `Player ${version}`,
    version,
    note: `Note for v${version}`,
    recordingId: null,
    createdAt: new Date(Date.UTC(2026, 10, version)).toISOString(),
    parentVersion,
    ...extra,
  }
}

// v6 and v9 approved; v9 is newer, so it opens by default.
const VERSIONS = [
  ver(1, null),
  ver(2, 1),
  ver(3, 2),
  ver(4, 1),
  ver(5, 4),
  ver(6, 3, { approved: true }),
  ver(9, 5, { approved: true }),
]

function page(route = '/projects/p1', routes: Routes = {}, user: unknown = MAYA) {
  return renderApp(route, {
    'GET /api/auth/me': envelope(200, 'OK', user),
    'GET /api/projects/p1': envelope(200, 'OK', PROJECT),
    'GET /api/projects/p1/contributions': envelope(200, 'OK', VERSIONS),
    ...routes,
  })
}

const card = () => screen.findByRole('article', { name: /^Open version/ })
const address = () => screen.getByTestId('address').textContent

describe('ProjectPage', () => {
  it('shows the title, the tags it has, and what it needs', async () => {
    page()
    expect(await screen.findByRole('heading', { level: 1, name: 'Porch Song' })).toBeInTheDocument()
    expect(screen.getByText('by Maya Okafor')).toBeInTheDocument()
    const tags = within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem')
    expect(tags.map((t) => t.textContent)).toEqual(['84 BPM', 'G major', 'Mellow'])
    const needs = within(screen.getByRole('list', { name: 'Needs' })).getAllByRole('listitem')
    expect(needs.map((t) => t.textContent)).toEqual(['Bass', 'Drums'])
  })

  it('opens the newest approved version by default', async () => {
    page()
    expect(await card()).toHaveAccessibleName('Open version: v9')
  })

  it('falls back to the default for a version that does not exist', async () => {
    page('/projects/p1?v=42')
    expect(await card()).toHaveAccessibleName('Open version: v9')
  })

  it('opens the version in the address and records the one you click', async () => {
    const user = userEvent.setup()
    page('/projects/p1?v=3')
    expect(await card()).toHaveAccessibleName('Open version: v3')
    await user.click(screen.getByRole('button', { name: /^v5 by Player 5/ }))
    expect(await card()).toHaveAccessibleName('Open version: v5')
    expect(address()).toBe('/projects/p1?v=5')
    expect(screen.getByText('Opened v5 by Player 5')).toBeInTheDocument()
  })

  it('keeps the open version when the owner unapproves it', async () => {
    const user = userEvent.setup()
    page('/projects/p1', { 'DELETE /api/projects/p1/contributions/9/approval': { status: 204 } })
    await card()
    await user.click(screen.getByRole('button', { name: 'Unapprove v9' }))
    expect(await screen.findByRole('button', { name: 'Approve v9' })).toBeEnabled()
    expect(await card()).toHaveAccessibleName('Open version: v9')
    expect(screen.getByRole('button', { name: /^v9 by Player 9$/ })).toBeInTheDocument()
  })

  it('undoes an approval the server refuses', async () => {
    const user = userEvent.setup()
    page('/projects/p1?v=3', { 'PUT /api/projects/p1/contributions/3/approval': envelope(500, 'Server error') })
    await card()
    await user.click(screen.getByRole('button', { name: 'Approve v3' }))
    expect(await within(await card()).findByText("Couldn't approve v3.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve v3' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('treats a 403 the same way', async () => {
    const user = userEvent.setup()
    page('/projects/p1?v=3', { 'PUT /api/projects/p1/contributions/3/approval': envelope(403, 'Not your project') })
    await card()
    await user.click(screen.getByRole('button', { name: 'Approve v3' }))
    expect(await within(await card()).findByText("Couldn't approve v3.")).toBeInTheDocument()
  })

  it('shows approval controls to the owner only', async () => {
    page('/projects/p1', {}, RILEY)
    await card()
    expect(screen.queryByRole('button', { name: /^(un)?approve v/i })).not.toBeInTheDocument()
  })

  it('says when the project does not exist', async () => {
    page('/projects/p1', { 'GET /api/projects/p1': envelope(404, 'Project not found') })
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
  })

  it('offers Retry when loading fails', async () => {
    const user = userEvent.setup()
    const { routes } = page('/projects/p1', { 'GET /api/projects/p1': envelope(500, 'Server error') })
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this project.")
    routes['GET /api/projects/p1'] = envelope(200, 'OK', PROJECT)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await card()).toBeInTheDocument()
  })

  it('says when there are no versions yet', async () => {
    page('/projects/p1', { 'GET /api/projects/p1/contributions': envelope(200, 'OK', []) })
    expect(await screen.findByText('No versions yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Porch Song' })).toBeInTheDocument()
  })

  it('names the base version for Add your part', async () => {
    const user = userEvent.setup()
    page()
    await card()
    await user.click(screen.getByRole('button', { name: 'Add your part on top of v9' }))
    expect(within(await card()).getByText(/You'd be building on v9/)).toBeInTheDocument()
  })

  it('downloads a version by fetching its recording', async () => {
    const user = userEvent.setup()
    const withRec = VERSIONS.map((v) => (v.version === 9 ? { ...v, recordingId: 'r9' } : v))
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { fetch } = page('/projects/p1', {
      'GET /api/projects/p1/contributions': envelope(200, 'OK', withRec),
      'GET /api/recordings/r9/playback-url': envelope(200, 'OK', { url: 'https://s3/r9', expiresAt: 'x' }),
      'GET https://s3/r9': { status: 200, body: 'bytes' },
    })
    await card()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain('https://s3/r9')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })
})

describe('demo project', () => {
  it('works with no server and no sign-in, and approves locally', async () => {
    const user = userEvent.setup()
    renderApp('/demo/project', { 'GET /api/health': envelope(500, 'down') })
    expect(await screen.findByText(/Demo project with made-up data/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Porch Song' })).toBeInTheDocument()
    expect(await card()).toHaveAccessibleName('Open version: v6')
    await user.click(screen.getByRole('button', { name: 'Unapprove v6' }))
    expect(await screen.findByRole('button', { name: 'Approve v6' })).toBeEnabled()
  })
})
