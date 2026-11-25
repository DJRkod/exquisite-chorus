import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_PROJECT } from './demoProject.ts'
import { layoutTree } from './treeLayout.ts'
import type { VersionNode } from './types.ts'
import VersionCard, { type VersionCardProps } from './VersionCard.tsx'
import VersionTree from './VersionTree.tsx'
import { buildTree, lineage } from './versionTree.ts'

const tree = buildTree(DEMO_PROJECT.versions)
const layout = layoutTree(tree)

function renderTree(open = 6, onSelect = vi.fn()) {
  render(
    <VersionTree
      tree={tree}
      layout={layout}
      open={open}
      lineage={lineage(tree, open)}
      ownerName="Maya Okafor"
      onSelect={onSelect}
      card={<p>the card</p>}
      wide={false}
    />,
  )
  return onSelect
}

const dot = (name: RegExp) => screen.getByRole('button', { name })

describe('VersionTree', () => {
  it('draws one named button per version', () => {
    renderTree()
    expect(dot(/^v3 by Jordan Hale, adds Drums, approved$/)).toBeInTheDocument()
    expect(dot(/^v1 by Maya Okafor, adds Guitar and Vocals, the original$/)).toBeInTheDocument()
    const dots = screen.getAllByRole('button', { name: /^v\d+ by / })
    expect(dots).toHaveLength(10)
  })

  it('makes only the open dot a tab stop', () => {
    renderTree(6)
    const stops = screen.getAllByRole('button', { name: /^v\d+ by / }).filter((b) => b.tabIndex === 0)
    expect(stops).toEqual([dot(/^v6 by/)])
    expect(dot(/^v6 by/)).toHaveAttribute('aria-current', 'true')
  })

  it('moves focus with the arrow keys', async () => {
    const user = userEvent.setup()
    renderTree(1)
    dot(/^v1 by/).focus()
    // v1's children by drawn position; the middle one is the biggest branch, v2.
    await user.keyboard('{ArrowUp}')
    expect(dot(/^v2 by/)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(dot(/^v1 by/)).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowRight}')
    const row = layout.rows[1]
    expect(document.activeElement).toBe(dot(new RegExp(`^v${row[row.indexOf(2) + 1]} by`)))
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(document.activeElement).toBe(dot(new RegExp(`^v${row[row.length - 1]} by`)))
    await user.keyboard('{Home}')
    expect(dot(/^v1 by/)).toHaveFocus()
  })

  it('opens a version with Enter', async () => {
    const user = userEvent.setup()
    const onSelect = renderTree(6)
    dot(/^v6 by/).focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it('shows a popout on focus and hides it with Escape', async () => {
    const user = userEvent.setup()
    renderTree(6)
    dot(/^v6 by/).focus()
    await user.keyboard('{ArrowDown}')
    const pop = screen.getByRole('tooltip')
    expect(pop).toHaveTextContent('Brushed drums, light on the verses.')
    expect(pop).toHaveTextContent('Approved by Maya')
    expect(dot(/^v3 by/)).toHaveAttribute('aria-describedby', 'vt-popout')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens directly on a touch tap without a popout', () => {
    const onSelect = renderTree(6)
    const v9 = dot(/^v9 by/)
    fireEvent.pointerDown(v9, { pointerType: 'touch' })
    v9.focus()
    fireEvent.click(v9)
    expect(onSelect).toHaveBeenCalledWith(9)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('leaves the page where it is on first load and scrolls to the card after a selection', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
    try {
      const props = { tree, layout, ownerName: 'Maya Okafor', onSelect: vi.fn(), card: <p>the card</p>, wide: false }
      const { rerender } = render(<VersionTree {...props} open={6} lineage={lineage(tree, 6)} />)
      expect(scrollIntoView).not.toHaveBeenCalled()
      rerender(<VersionTree {...props} open={9} lineage={lineage(tree, 9)} />)
      const scrolled = scrollIntoView.mock.contexts as Element[]
      expect(scrolled).toContain(screen.getByText('the card').parentElement)
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('offers a list view that opens versions too', async () => {
    const user = userEvent.setup()
    const onSelect = renderTree(6)
    await user.click(screen.getByRole('button', { name: 'List view' }))
    const list = screen.getAllByRole('list')[0]
    const items = within(list).getAllByRole('button')
    expect(items).toHaveLength(10)
    // v3 is nested inside v2's item.
    const v2Item = within(list).getByRole('button', { name: /^v2 ·/ }).closest('li')!
    expect(within(v2Item).getByRole('button', { name: /^v3 ·.*Approved$/ })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: /^v6 ·/ })).toHaveAttribute('aria-current', 'true')
    await user.click(within(list).getByRole('button', { name: /^v9 ·/ }))
    expect(onSelect).toHaveBeenCalledWith(9)
  })
})

const NODE: VersionNode = { ...DEMO_PROJECT.versions[2] }

function renderCard(props: Partial<VersionCardProps> = {}) {
  const all: VersionCardProps = {
    node: NODE,
    isRoot: false,
    parentVersion: 2,
    childCount: 2,
    ownerName: 'Maya Okafor',
    isOwner: true,
    approvePending: false,
    playState: 'idle',
    downloading: false,
    message: null,
    onTogglePlay: vi.fn(),
    onDownload: vi.fn(),
    onAddPart: vi.fn(),
    onToggleApprove: vi.fn(),
    ...props,
  }
  render(<VersionCard {...all} />)
  return all
}

describe('VersionCard', () => {
  it('shows the details and the actions', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Jordan Hale' })).toBeInTheDocument()
    expect(screen.getByText(/built on v2 · 2 built on this/)).toBeInTheDocument()
    expect(screen.getByText('Brushed drums, light on the verses.')).toBeInTheDocument()
    expect(screen.getByText('Approved by Maya')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add your part on top of v3' })).toBeEnabled()
  })

  it('gives the owner Unapprove on an approved version and Approve otherwise', () => {
    renderCard()
    expect(screen.getByRole('button', { name: 'Unapprove v3' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('gives the owner Approve on an unapproved version', () => {
    renderCard({ node: { ...NODE, approved: false } })
    expect(screen.getByRole('button', { name: 'Approve v3' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('gives everyone else no approval control', () => {
    renderCard({ isOwner: false })
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.getByText('Approved by Maya')).toBeInTheDocument()
  })

  it('disables Play and Download without a recording', () => {
    renderCard()
    expect(screen.getByRole('button', { name: 'Play v3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Play v3' })).toHaveAccessibleDescription('No recording yet')
  })

  it('shows loading and playing states', () => {
    renderCard({ node: { ...NODE, recordingId: 'r3' }, playState: 'loading' })
    expect(screen.getByRole('button', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true')
  })

  it('shows a message', () => {
    renderCard({ message: "Couldn't play v3" })
    expect(screen.getByText("Couldn't play v3")).toBeInTheDocument()
  })
})
