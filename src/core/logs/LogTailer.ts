import { open, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'chokidar'

/**
 * Follows a growing text file (Client.txt) and emits complete lines.
 *
 * - Starts at the end of the file by default (history is not replayed).
 * - Handles truncation / rotation (file size shrinks → restart from 0).
 * - Buffers partial lines until the newline arrives.
 */
export interface LogTailerOptions {
  /** Replay the last N bytes on start (useful to recover a run in progress). */
  replayBytes?: number
  /** Polling interval used by the watcher, in ms. Client.txt is often on slow disks. */
  pollIntervalMs?: number
}

export class LogTailer {
  private position = 0
  private partial = ''
  private watcher: FSWatcher | null = null
  private reading: Promise<void> = Promise.resolve()
  private readonly decoder = new TextDecoder('utf-8')

  constructor(
    private readonly path: string,
    private readonly onLine: (line: string) => void,
    private readonly opts: LogTailerOptions = {}
  ) {}

  async start(): Promise<void> {
    const s = await stat(this.path)
    this.position = Math.max(0, s.size - (this.opts.replayBytes ?? 0))
    if (this.position > 0 && this.opts.replayBytes) {
      // Skip to the next full line so we never emit half a line.
      this.partial = ''
      this.skipFirstPartial = true
    }
    if (this.opts.replayBytes) await this.readNew()

    this.watcher = watch(this.path, {
      usePolling: true,
      interval: this.opts.pollIntervalMs ?? 500,
      awaitWriteFinish: false
    })
    this.watcher.on('change', () => this.schedule())
  }

  async stop(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    await this.reading
  }

  /** Read any new bytes now (also used by tests). */
  flush(): Promise<void> {
    return this.schedule()
  }

  private skipFirstPartial = false

  private schedule(): Promise<void> {
    this.reading = this.reading.then(() => this.readNew()).catch(() => undefined)
    return this.reading
  }

  private async readNew(): Promise<void> {
    const s = await stat(this.path)
    if (s.size < this.position) {
      // Truncated or replaced: start over.
      this.position = 0
      this.partial = ''
    }
    if (s.size === this.position) return

    const fh = await open(this.path, 'r')
    try {
      const length = s.size - this.position
      const buf = Buffer.alloc(length)
      const { bytesRead } = await fh.read(buf, 0, length, this.position)
      this.position += bytesRead
      const text = this.partial + this.decoder.decode(buf.subarray(0, bytesRead), { stream: true })
      const lines = text.split('\n')
      this.partial = lines.pop() ?? ''
      for (let i = 0; i < lines.length; i++) {
        if (i === 0 && this.skipFirstPartial) {
          this.skipFirstPartial = false
          continue
        }
        const line = lines[i]!.replace(/\r$/, '')
        if (line.length > 0) this.onLine(line)
      }
    } finally {
      await fh.close()
    }
  }
}
