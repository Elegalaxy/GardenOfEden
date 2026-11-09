// The player's tools and their keyboard shortcuts. Pure data, shared by the
// toolbar, the store and the canvas. Keys 1-7 pick a tool, in the order of the
// buttons (inspect, the placement tools for resource, water, danger and shelter,
// then bot and remove), and Esc returns to inspect. The two area world events
// (plague, meteor) are also tools: P and M arm them, then a click on the map
// triggers the event there. Drought and bounty are global, so they are not tools
// (eventInfo.ts has their D and B keys).

import type { EventKind, NodeKind } from '../sim/types.ts'

export type Tool = 'inspect' | 'resource' | 'water' | 'danger' | 'shelter' | 'bot' | 'remove' | 'plague' | 'meteor'

/** What the player has selected on the map. Ids are never reused, so a stale selection is detectable. */
export type Selection = { kind: 'bot' | 'node'; id: number }

export type ToolInfo = {
  id: Tool
  /** Shown on the button. */
  label: string
  /** Keyboard shortcut (also the button's hint). */
  key: string
  /** One line telling the player what a click does. */
  hint: string
  /** The node a placement tool adds. */
  nodeKind?: NodeKind
  /** The world event an event tool triggers where you click. */
  event?: EventKind
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'inspect', label: 'Inspect', key: '1', hint: 'Click a bot or node to see its details.' },
  { id: 'resource', label: 'Add resource', key: '2', hint: 'Click the map to place a food node.', nodeKind: 'resource' },
  { id: 'water', label: 'Add water', key: '3', hint: 'Click the map to place a spring. Bots drink here and it never runs dry.', nodeKind: 'water' },
  { id: 'danger', label: 'Add danger', key: '4', hint: 'Click the map to place a danger zone.', nodeKind: 'danger' },
  { id: 'shelter', label: 'Add shelter', key: '5', hint: 'Click the map to place a shelter.', nodeKind: 'shelter' },
  { id: 'bot', label: 'Add bot', key: '6', hint: 'Click the map to place a bot.' },
  { id: 'remove', label: 'Remove', key: '7', hint: 'Click a node to remove it. Bots cannot be removed.' },
]

/** The area world events, armed from the Events panel (or by their key) and then clicked onto the map. */
export const EVENT_TOOLS: readonly ToolInfo[] = [
  { id: 'plague', label: 'Plague', key: 'p', hint: 'Click the map to start a plague zone there. Bots inside it lose health.', event: 'plague' },
  { id: 'meteor', label: 'Meteor', key: 'm', hint: 'Click the map to drop a meteor there. It kills bots at the centre and leaves a danger crater.', event: 'meteor' },
]

export function toolInfo(id: Tool): ToolInfo {
  return TOOLS.find((tool) => tool.id === id) ?? EVENT_TOOLS.find((tool) => tool.id === id) ?? TOOLS[0]!
}

/** The tool a pressed key selects, or null. Esc is inspect. */
export function toolForKey(key: string): Tool | null {
  if (key === 'Escape') return 'inspect'
  return TOOLS.find((tool) => tool.key === key)?.id ?? EVENT_TOOLS.find((tool) => tool.key === key)?.id ?? null
}
