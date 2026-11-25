import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { envelope, type Reply, type Routes } from '../test/fakeApi.ts'
import { installMedia } from '../test/fakeMedia.ts'
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

})

describe('ProjectPage recordings', () => {
  // v9 and v5 have recordings; the rest don't.
  const WITH_RECORDINGS = VERSIONS.map((v) =>
    v.version === 9 || v.version === 5 ? { ...v, recordingId: `r${v.version}` } : v,
  )
  const URL_OK = (n: number) => envelope(200, 'OK', { url: `https://s3/r${n}`, expiresAt: 'x' })
  let media: ReturnType<typeof installMedia>

  beforeEach(() => {
    media = installMedia()
  })
  afterEach(() => media.restore())

  function recPage(routes: Routes = {}) {
    return page('/projects/p1', {
      'GET /api/projects/p1/contributions': envelope(200, 'OK', WITH_RECORDINGS),
      'GET /api/recordings/r9/playback-url': URL_OK(9),
      'GET /api/recordings/r5/playback-url': URL_OK(5),
      'GET https://s3/r9': { status: 200, body: 'bytes' },
      ...routes,
    })
  }

  it('plays the open version and stops when another version opens', async () => {
    const user = userEvent.setup()
    recPage()
    await card()
    await user.click(screen.getByRole('button', { name: 'Play v9' }))
    expect(await screen.findByRole('button', { name: 'Pause v9' })).toBeInTheDocument()

    media.pause.mockClear()
    await user.click(screen.getByRole('button', { name: /^v5 by Player 5/ }))
    expect(await screen.findByRole('button', { name: 'Play v5' })).toBeEnabled()
    expect(media.pause).toHaveBeenCalled()
  })

  it('pauses on a second click', async () => {
    const user = userEvent.setup()
    recPage()
    await card()
    await user.click(screen.getByRole('button', { name: 'Play v9' }))
    await user.click(await screen.findByRole('button', { name: 'Pause v9' }))
    expect(await screen.findByRole('button', { name: 'Play v9' })).toBeEnabled()
  })

  it('ignores the silent unlock clip ending while the recording loads', async () => {
    const user = userEvent.setup()
    let answer: (reply: Reply) => void = () => {}
    recPage({ 'GET /api/recordings/r9/playback-url': () => new Promise<Reply>((resolve) => (answer = resolve)) })
    await card()
    await user.click(screen.getByRole('button', { name: 'Play v9' }))
    const audio = document.querySelector('audio')!
    expect(audio.src).toMatch(/^blob:/)
    act(() => {
      audio.dispatchEvent(new Event('ended'))
    })
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeInTheDocument()
    answer(URL_OK(9))
    expect(await screen.findByRole('button', { name: 'Pause v9' })).toBeInTheDocument()
  })

  it('says when a version cannot play', async () => {
    const user = userEvent.setup()
    recPage({ 'GET /api/recordings/r9/playback-url': envelope(500, 'Server error') })
    await card()
    await user.click(screen.getByRole('button', { name: 'Play v9' }))
    expect(await within(await card()).findByText("Couldn't play v9.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play v9' })).toBeEnabled()
  })

  it('downloads a version by fetching its recording', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { fetch } = recPage()
    await card()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const saved = click.mock.contexts[0] as HTMLAnchorElement
    expect(saved.download).toBe('Porch Song v9')
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain('https://s3/r9')
    expect(media.revokeObjectURL).toHaveBeenCalledWith(saved.href)
  })

  it('opens the recording in a new tab when the file cannot be fetched', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    recPage({ 'GET https://s3/r9': { status: 403, body: 'denied' } })
    await card()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://s3/r9', '_blank', 'noopener'))
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  })

  it('says when a download cannot start', async () => {
    const user = userEvent.setup()
    recPage({ 'GET /api/recordings/r9/playback-url': envelope(500, 'Server error') })
    await card()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(await within(await card()).findByText("Couldn't download v9.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
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
