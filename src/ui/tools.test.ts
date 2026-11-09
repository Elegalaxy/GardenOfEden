import { describe, expect, it } from 'vitest'

import { TOOLS, toolForKey, toolInfo } from './tools.ts'

describe('tools', () => {
  it('numbers the buttons 1 to 7 in order, with no key used twice', () => {
    expect(TOOLS.map((tool) => tool.key)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('has a water tool on key 3 that places water', () => {
    expect(toolForKey('3')).toBe('water')
    expect(toolInfo('water')).toMatchObject({ label: 'Add water', key: '3', nodeKind: 'water' })
  })

  it('keeps every other key pointing at the tool it is printed on', () => {
    for (const tool of TOOLS) expect(toolForKey(tool.key)).toBe(tool.id)
    expect(toolInfo('bot').key).toBe('6')
    expect(toolInfo('remove').key).toBe('7')
  })

  it('goes back to inspect on Esc and ignores other keys', () => {
    expect(toolForKey('Escape')).toBe('inspect')
    expect(toolForKey('8')).toBeNull()
    expect(toolForKey('w')).toBeNull()
  })

  it('gives each placement tool the node kind it adds, and the others none', () => {
    const kinds = TOOLS.filter((tool) => tool.nodeKind !== undefined).map((tool) => [tool.id, tool.nodeKind])
    expect(kinds).toEqual([
      ['resource', 'resource'],
      ['water', 'water'],
      ['danger', 'danger'],
      ['shelter', 'shelter'],
    ])
  })
})
