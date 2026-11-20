import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ItemAudit } from '../build/gearCheck'
import type { DetailedItem } from '../build/targetCompare'
import type { SkillGroup, TreeDetail } from '../build/treeGemsCompare'

/**
 * Runs the Path of Building (PoE 2) engine headless in a LuaJIT child process
 * and talks to it through `resources/pob/bridge.lua` (newline-delimited JSON).
 *
 * PoB itself is not modified: it is downloaded/updated separately
 * (see scripts/setup-pob.mjs) and only driven through its HeadlessWrapper.
 */

const RESPONSE_PREFIX = '@@POB@@'

export interface PobBridgeOptions {
  /** LuaJIT executable (must support compound assignment, LuaJIT ≥ 2026-07). */
  luajitPath: string
  /** Root of the PathOfBuilding-PoE2 checkout (contains `src/` and `runtime/`). */
  pobDir: string
  /** Path to resources/pob/bridge.lua. */
  bridgeScript: string
  /** Extra directories holding native Lua modules (lua-utf8). */
  luaCPath?: string[]
  /** Directories put first in PATH (native libraries such as zlib). */
  extraPath?: string[]
  /** Per-request timeout. Startup gets `startupTimeoutMs`. */
  requestTimeoutMs?: number
  startupTimeoutMs?: number
  onLog?: (line: string) => void
}

export type StatMap = Record<string, number>

export interface BuildInfo {
  className?: string
  ascendancy?: string
  level?: number
  mainSkill?: string
}

export interface EquippedItem {
  slot: string
  name: string
  rarity: string
  base?: string
}

export interface BuildSnapshot {
  info: BuildInfo
  stats: StatMap
  items?: EquippedItem[]
}

export interface StatChange {
  before: number
  after: number
  delta: number
}

export interface TradeWeights {
  slot: string
  category?: string
  minWeight?: number
  base?: string
  weights: { tradeId: string; text: string; weight: number; score: number; typical: number }[]
}

export interface ItemComparison {
  slot: string
  item: { name: string; rarity: string; base?: string }
  before: StatMap
  after: StatMap
  diff: Record<string, StatChange>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class PobBridgeError extends Error {}

export class PobBridge {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readyPromise: Promise<void> | null = null
  private starts = 0

  constructor(private readonly opts: PobBridgeOptions) {}

  get running(): boolean {
    return this.proc !== null
  }

  /** Increases each time a new engine process is spawned (to detect restarts after a crash). */
  get startCount(): number {
    return this.starts
  }

  /** Kill the engine process (simulates a crash in tests; the next request restarts it). */
  kill(): void {
    this.proc?.kill()
  }

  /** Spawn LuaJIT and wait until PoB has finished loading. Idempotent. */
  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise
    const { luajitPath, pobDir, bridgeScript } = this.opts
    const runtimeLua = join(pobDir, 'runtime', 'lua')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LUA_PATH: [join(runtimeLua, '?.lua'), join(runtimeLua, '?', 'init.lua'), ''].join(';') + ';',
      LUA_CPATH: [...(this.opts.luaCPath ?? []).map((d) => join(d, process.platform === 'win32' ? '?.dll' : '?.so')), ''].join(';') + ';'
    }
    // Native libraries next to luajit (lua51.dll, zlib1.dll, MSVC runtime on Windows).
    if (this.opts.extraPath?.length) {
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
      env[key] = [...this.opts.extraPath, env[key] ?? ''].join(delimiter)
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const proc = spawn(luajitPath, [bridgeScript], { cwd: join(pobDir, 'src'), env, windowsHide: true })
      this.proc = proc
      this.starts += 1

      const startupTimer = setTimeout(() => {
        reject(new PobBridgeError('Path of Building did not start in time'))
        this.stop()
      }, this.opts.startupTimeoutMs ?? 60_000)

      this.pending.set(0, {
        resolve: () => {
          clearTimeout(startupTimer)
          resolve()
        },
        reject: (e) => {
          clearTimeout(startupTimer)
          reject(e)
        },
        timer: startupTimer
      })

      createInterface({ input: proc.stdout }).on('line', (line) => this.onStdout(line))
      createInterface({ input: proc.stderr }).on('line', (line) => this.opts.onLog?.(line))

      proc.on('error', (err) => this.failAll(new PobBridgeError(`Failed to start LuaJIT: ${err.message}`)))
      proc.on('exit', (code, signal) => {
        this.proc = null
        this.readyPromise = null
        this.failAll(new PobBridgeError(`Path of Building exited (code ${code}, signal ${signal})`))
      })
    })
    return this.readyPromise
  }

  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    try {
      await this.request('quit', {}, 2000)
    } catch {
      // ignore
    }
    if (this.proc) proc.kill()
    this.proc = null
    this.readyPromise = null
  }

  ping(): Promise<{ pong: boolean; version?: string }> {
    return this.request('ping')
  }

  newBuild(): Promise<BuildSnapshot> {
    return this.request('new_build')
  }

  /** Import a PoB build code (as shared on pobb.in / exported by PoB). */
  loadCode(code: string, name?: string): Promise<BuildSnapshot> {
    return this.request('load_code', { code, name })
  }

  loadXml(xml: string, name?: string): Promise<BuildSnapshot> {
    return this.request('load_xml', { xml, name })
  }

  exportCode(): Promise<{ code: string }> {
    return this.request('export_code')
  }

  stats(): Promise<BuildSnapshot> {
    return this.request('stats')
  }

  /** Compare an item (text copied in game with Ctrl+C) against what is equipped in its slot. */
  compareItem(itemText: string, slot?: string): Promise<ItemComparison> {
    return this.request('compare_item', { itemText, slot })
  }

  /** Equip an item in its slot (replacing the current one) and return the new build stats. */
  equipItem(itemText: string, slot?: string): Promise<BuildSnapshot & { slot: string }> {
    return this.request('equip_item', { itemText, slot })
  }

  /** Facts about every equipped item (sockets, modifiers, base level…) for the gear check. */
  auditItems(): Promise<{ characterLevel: number; items: ItemAudit[] }> {
    return this.request('audit_items')
  }

  /** Every equipped item with raw text and resolved mod lines. */
  itemsDetail(): Promise<{ items: DetailedItem[] }> {
    return this.request('items_detail')
  }

  treeDetail(): Promise<TreeDetail> {
    return this.request('tree_detail')
  }

  skillsDetail(): Promise<{ groups: SkillGroup[] }> {
    return this.request('skills_detail')
  }

  /** PoB's trade weights for upgrading the item in this slot. */
  tradeWeights(slot: string): Promise<TradeWeights> {
    return this.request('trade_weights', { slot }, 120_000)
  }

  /** What an item with these stats would change in this slot. */
  tradePreview(
    slot: string,
    mods: { tradeId: string; text: string; value: number }[],
    base?: string
  ): Promise<{ slot: string; lines: string[]; before: StatMap; after: StatMap; diff: Record<string, StatChange> }> {
    return this.request('trade_preview', { slot, mods, base })
  }

  compareNode(nodeId: number): Promise<{ node: { id: number; name: string } } & Omit<ItemComparison, 'slot' | 'item'>> {
    return this.request('compare_node', { nodeId })
  }

  private async request<T>(cmd: string, payload: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (cmd !== 'quit') await this.start()
    const proc = this.proc
    if (!proc) throw new PobBridgeError('Path of Building is not running')
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new PobBridgeError(`Path of Building request "${cmd}" timed out`))
      }, timeoutMs ?? this.opts.requestTimeoutMs ?? 30_000)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      proc.stdin.write(JSON.stringify({ id, cmd, ...payload }) + '\n')
    })
  }

  private onStdout(line: string): void {
    if (!line.startsWith(RESPONSE_PREFIX)) {
      this.opts.onLog?.(line)
      return
    }
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: string }
    try {
      msg = JSON.parse(line.slice(RESPONSE_PREFIX.length))
    } catch {
      this.opts.onLog?.(`unparseable PoB response: ${line}`)
      return
    }
    if (typeof msg.id !== 'number') return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new PobBridgeError(firstLine(msg.error ?? 'unknown PoB error')))
  }

  private failAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
      this.pending.delete(id)
    }
  }
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? s
}
