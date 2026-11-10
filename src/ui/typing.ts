// Whether a key press happened while the player was typing in a field, so the keyboard shortcuts (tools, world events, the heatmap) can leave it alone.

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
