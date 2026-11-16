// A small colour chip for a bot's bloodline hue (M20). Decorative: the id or the "hue 212°" text beside it carries the meaning.

import { bloodlineColour } from './botColour.ts'

export function HueSwatch({ hue }: { hue: number }) {
  return <span className="hue-swatch" style={{ backgroundColor: bloodlineColour(hue) }} aria-hidden="true" />
}
