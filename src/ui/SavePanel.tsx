// Save and load (M9). A run is its seed, preset and commands, so a save is tiny.
//   Save to file       downloads garden-of-eden-<seed>-t<tick>.json
//   Load from file     reads a save the player picks; asks first if this run has commands
//   Copy share link    puts the run in the address-bar fragment (capped; long runs use a file)
//   Resume last run    the browser keeps the latest run automatically (autosave.ts)
// A load replays the run in slices with a progress bar and a Cancel button, and the old
// run stays until the new one is complete. It lives in the header's Run & save menu
// (RunMenu.tsx), which also shows results when it is closed. The row of buttons and the
// progress row take the same height, so the menu does not jump while a load runs.
// Everything read from a file is untrusted: it goes through `decodeSave`, and the seed
// and other text are only ever rendered as text.

import { useId, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { MAX_SAVE_CHARS, decodeSave, encodeSave, makeSave, saveFileName } from '../persist/save.ts'
import type { Save } from '../persist/save.ts'
import { encodeShare } from '../persist/share.ts'
import { clearStoredRun, useAutosave } from './autosave.ts'
import { downloadText } from './download.ts'
import { shareUrl } from './shareLink.ts'
import { cancelLoad, exportSave, reportSave, startLoad, useWorldStore } from './store.ts'

const numberFormat = new Intl.NumberFormat('en-US')
const PLACEHOLDER_HASH = '0000000000000000'

const NOTICE_ICON = { ok: '✓', warn: '⚠', error: '✕' } as const

function plural(count: number, word: string): string {
  return `${numberFormat.format(count)} ${word}${count === 1 ? '' : 's'}`
}

function describe(save: Pick<Save, 'seed' | 'tick' | 'commands'>): string {
  return `seed "${save.seed}", tick ${numberFormat.format(save.tick)}, ${plural(save.commands.length, 'command')}`
}

export function SavePanel() {
  const { world, seed, presetId, runId, tick, commandCount, load, saveNotice } = useWorldStore()
  const autosave = useAutosave()
  const [pending, setPending] = useState<Save | null>(null)
  const [linkText, setLinkText] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileId = useId()
  const linkId = useId()

  // Whether the run fits in a link. `world` is mutated in place, so the command count and
  // run id say when the answer can have changed.
  const shareFit = useMemo(
    () => encodeShare(makeSave(world, presetId, PLACEHOLDER_HASH)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commandCount, runId, presetId],
  )

  const requestLoad = (save: Save): void => {
    if (commandCount > 0) setPending(save)
    else void startLoad(save)
  }

  const onSave = (): void => {
    try {
      const save = exportSave()
      downloadText(saveFileName(save), encodeSave(save))
      reportSave('ok', `Saved ${saveFileName(save)} (${plural(save.commands.length, 'command')}).`)
    } catch {
      reportSave('error', 'The save file could not be created.')
    }
  }

  const onFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = '' // so the same file can be picked again
    if (file === undefined) return
    if (file.size > MAX_SAVE_CHARS) {
      reportSave('error', 'This file is too large to be a save (over 1 MB). Your current run was kept.')
      return
    }
    file
      .text()
      .then((text) => {
        const result = decodeSave(text)
        if (!result.ok) reportSave('error', `${result.error.message} Your current run was kept.`)
        else requestLoad(result.save)
      })
      .catch(() => reportSave('error', 'The file could not be read. Your current run was kept.'))
  }

  const onShare = (): void => {
    const encoded = encodeShare(exportSave())
    if (!encoded.ok) {
      reportSave('error', encoded.message)
      return
    }
    const url = shareUrl(encoded.fragment)
    const done = (): void => {
      setLinkText(null)
      reportSave('ok', `Link copied. Opening it loads this run, paused at tick ${numberFormat.format(tick)}.`)
    }
    const manual = (): void => {
      setLinkText(url)
      reportSave('warn', 'The link could not be copied automatically. Select it below and copy it yourself.')
    }
    try {
      navigator.clipboard.writeText(url).then(done, manual)
    } catch {
      manual()
    }
  }

  const onClearAutosave = (): void => {
    clearStoredRun()
    reportSave('ok', 'The autosaved run was removed from this browser.')
  }

  const shareReason = shareFit.ok ? null : shareFit.message
  const saved = autosave.saved

  return (
    <section className="save-panel" aria-label="Save and load">
      <input
        ref={fileInput}
        id={fileId}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Choose a save file"
        onChange={onFile}
      />
      {load !== null ? (
        <div className="save-row save-progress" role="group" aria-label="Loading a saved run">
          <progress max={Math.max(1, load.target)} value={load.tick} aria-label="Replay progress" />
          <span className="save-progress-text figure">
            Replaying tick {numberFormat.format(load.tick)} of {numberFormat.format(load.target)} (
            {load.target === 0 ? 100 : Math.floor((load.tick / load.target) * 100)}%)
          </span>
          <button type="button" className="secondary" onClick={cancelLoad}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="save-row">
          <div className="save-group">
            <button type="button" className="secondary" onClick={onSave}>
              Save to file
            </button>
            <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>
              Load from file
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onShare}
              disabled={!shareFit.ok}
              title={shareReason ?? 'Copy a link that opens this run'}
            >
              Copy share link
            </button>
          </div>
          <div className="save-group save-resume">
            <button
              type="button"
              className="secondary"
              disabled={saved === null}
              title={saved === null ? 'No autosaved run yet' : 'Load the run this browser kept'}
              onClick={() => saved !== null && requestLoad(saved)}
            >
              Resume last run
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saved === null}
              title={saved === null ? 'No autosaved run to clear' : 'Remove the autosaved run from this browser'}
              onClick={onClearAutosave}
            >
              Clear
            </button>
            <span className="save-autosave">
              {saved !== null
                ? `Autosaved: ${describe(saved)}.`
                : autosave.available
                  ? 'No autosaved run yet. Your run is kept here once you place something or start a world.'
                  : 'Autosave is unavailable in this browser.'}
            </span>
          </div>
        </div>
      )}

      {pending !== null ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm loading a saved run">
          <p>
            Replace this run ({describe({ seed, tick, commands: world.commands })}) with the saved run ({describe(pending)})? This
            run&rsquo;s {plural(commandCount, 'command')} are lost unless you saved them.
          </p>
          <div className="confirm-buttons">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const save = pending
                setPending(null)
                void startLoad(save)
              }}
            >
              Replace and load
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setPending(null)
                reportSave('ok', 'Kept your current run. Nothing was loaded.')
              }}
            >
              Keep this run
            </button>
          </div>
        </div>
      ) : (
        <p
          className={`save-status ${saveNotice === null ? '' : `save-${saveNotice.level}`}`}
          role="status"
          aria-live="polite"
        >
          {saveNotice !== null ? (
            <>
              <span aria-hidden="true">{NOTICE_ICON[saveNotice.level]}</span> {saveNotice.text}
            </>
          ) : shareReason !== null ? (
            <>
              <span aria-hidden="true">⚠</span> Share link unavailable: {shareReason}
            </>
          ) : (
            ' '
          )}
        </p>
      )}
      {linkText !== null && (
        <div className="save-link">
          <label htmlFor={linkId} className="run-label">
            Share link
          </label>
          <input
            id={linkId}
            className="seed-input save-link-input"
            readOnly
            value={linkText}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </section>
  )
}
