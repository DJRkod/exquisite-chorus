// Fake data for /demo/project, so the version tree can be seen before the
// projects API exists. Same ten versions as the design prototype.
import type { ProjectDto, Skill } from '@exquisite-chorus/shared'
import type { ProjectData, VersionNode } from './types.ts'

export const DEMO_OWNER_ID = 'demo-maya'

const people: Record<string, string> = {
  'demo-maya': 'Maya Okafor',
  'demo-riley': 'Riley Chen',
  'demo-jordan': 'Jordan Hale',
  'demo-sam': 'Sam Adeyemi',
  'demo-theo': 'Theo Lindqvist',
  'demo-ana': 'Ana Ruiz',
  'demo-leo': 'Leo Brandt',
  'demo-priya': 'Priya Nair',
  'demo-jules': 'Jules Park',
  'demo-kai': 'Kai Moreno',
}

const NOW = Date.UTC(2026, 10, 24, 18)
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

function version(
  n: number,
  parentVersion: number | null,
  who: string,
  ago: number,
  note: string,
  skillsAdded: Skill[],
  approved = false,
): VersionNode {
  return {
    id: `demo-c${n}`,
    projectId: 'demo',
    contributorId: who,
    contributorDisplayName: people[who],
    version: n,
    note,
    recordingId: null,
    createdAt: daysAgo(ago),
    parentVersion,
    approved,
    skillsAdded,
  }
}

const project: ProjectDto = {
  id: 'demo',
  ownerId: DEMO_OWNER_ID,
  ownerDisplayName: people[DEMO_OWNER_ID],
  title: 'Porch Song',
  description: 'A slow folk tune that started on a porch. Build on any version you like.',
  bpm: 84,
  musicalKey: 'G major',
  genre: 'Folk',
  mood: 'Mellow',
  needs: ['Bass', 'Drums', 'Strings'],
  status: 'open',
  currentVersion: 10,
  createdAt: daysAgo(12),
  updatedAt: daysAgo(0.25),
}

export const DEMO_PROJECT: ProjectData = {
  project,
  versions: [
    version(1, null, 'demo-maya', 12, 'Guitar and a scratch vocal, recorded on the porch.', ['Guitar', 'Vocals']),
    version(2, 1, 'demo-riley', 9, 'Walking bass line, kept it under the guitar.', ['Bass'], true),
    version(3, 2, 'demo-jordan', 7, 'Brushed drums, light on the verses.', ['Drums'], true),
    version(4, 1, 'demo-sam', 8, 'Darker synth bass instead of upright.', ['Bass', 'Synth']),
    version(5, 4, 'demo-theo', 5, 'Rhodes pads under the synth bass.', ['Keys']),
    version(6, 3, 'demo-ana', 4, 'Harmony vocals on both choruses.', ['Vocals'], true),
    version(7, 3, 'demo-leo', 3, 'Swapped the brushes for a full kit. Louder.', ['Drums']),
    version(8, 6, 'demo-priya', 2, 'Wrote and sang a second verse.', ['Lyrics', 'Vocals']),
    version(9, 5, 'demo-jules', 1, 'Trumpet line over the outro.', ['Brass']),
    version(10, 1, 'demo-kai', 0.25, 'Cello under the verse, nothing else touched.', ['Strings']),
  ],
}
