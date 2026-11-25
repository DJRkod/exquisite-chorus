import type { VersionNode } from './types.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** "6 hours ago", "yesterday", "4 days ago", or a date for anything older than a month. */
export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  if (ms < HOUR) return 'just now'
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    return h === 1 ? 'an hour ago' : `${h} hours ago`
  }
  const d = Math.floor(ms / DAY)
  if (d === 1) return 'yesterday'
  if (d < 31) return `${d} days ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export const who = (node: VersionNode) => node.contributorDisplayName ?? 'Someone'

export const firstName = (name: string) => name.split(' ')[0]

/** The dot's accessible name, e.g. "v3 by Jordan Hale, adds Drums, approved". */
export function versionLabel(node: VersionNode, isRoot: boolean): string {
  const parts = [`v${node.version} by ${who(node)}`]
  if (node.skillsAdded?.length) parts.push(`adds ${node.skillsAdded.join(' and ')}`)
  if (node.approved) parts.push('approved')
  if (isRoot) parts.push('the original')
  return parts.join(', ')
}
