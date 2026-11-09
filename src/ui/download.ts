// Hands a text file to the browser as a download. Browser-only (no tests: it needs a DOM).

export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // The download has started by now; give the browser a moment before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
