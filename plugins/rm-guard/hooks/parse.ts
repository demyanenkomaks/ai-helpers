/**
 * rm-guard: reading a shell command and judging the deletions in it.
 * Pure functions only, so the tests run them without an engine.
 */

export type Shell = 'bash' | 'powershell'

export type Decision = 'allow' | 'ask' | 'deny'

/** What a stopped command would delete, for the question put to the person. */
export type Target = {
  text: string
  /** The path is built from a variable or a substitution. */
  dynamic: boolean
  /** `search`: everything under it that find matches; `stdin`: paths another command produces. */
  kind?: 'search' | 'stdin'
}

export type Verdict = { decision: Decision; reason?: string; targets?: Target[] }

export type Policy = {
  /** Lower-cased names of the commands that stop. */
  commands: ReadonlySet<string>
  /** Paths where deletion passes without asking. */
  allow: readonly string[]
  home: string
  cwd: string
  shell: Shell
}

export type Word = { text: string; dynamic: boolean }

export const DEFAULT_COMMANDS =
  'rm,rmdir,unlink,shred,del,erase,rd,Remove-Item,ri,find'

const MAX_DEPTH = 6

/** Splits a settings value into trimmed, non-empty entries. */
export function parseList(raw: unknown, separator: RegExp): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(separator)
    .map(x => x.trim())
    .filter(x => x !== '')
}

/** The guarded command names; an empty or missing setting means the defaults. */
export function commandsFrom(raw: unknown): Set<string> {
  const listed = parseList(raw, /[,;\s]+/)
  const names = listed.length > 0 ? listed : parseList(DEFAULT_COMMANDS, /,/)
  return new Set(names.map(x => x.toLowerCase()))
}

export function allowFrom(raw: unknown): string[] {
  return parseList(raw, /[;\n]/)
}

// ---------------------------------------------------------------- tokenizer

const HOME_NAMES = new Set(['HOME', 'USERPROFILE'])

type Cx = { home: string; shell: Shell }

/** Reads `command` into simple commands (word lists), substitutions included. */
export function tokenize(command: string, cx: Cx): Word[][] {
  const out: Word[][] = []
  scan(command, cx, out, 0)
  return out
}

function scan(src: string, cx: Cx, out: Word[][], depth: number): void {
  const isPs = cx.shell === 'powershell'
  let cur: Word[] = []
  let text = ''
  let dynamic = false
  let inWord = false
  let skipNext = false

  const endWord = () => {
    if (inWord) {
      if (skipNext) skipNext = false
      else cur.push({ text, dynamic })
    }
    text = ''
    dynamic = false
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (cur.length > 0) out.push(cur)
    cur = []
  }
  const substitute = (inner: string) => {
    if (depth < MAX_DEPTH) scan(inner, cx, out, depth + 1)
    dynamic = true
    inWord = true
  }

  /** `$(...)` starting at `from` (the `$`): the inner text and the next index. */
  const parens = (from: number): [string, number] => {
    let level = 0
    let quote = ''
    let j = from + 1
    for (; j < src.length; j++) {
      const c = src[j] as string
      if (quote !== '') {
        if (c === quote) quote = ''
        continue
      }
      if (c === "'" || c === '"') quote = c
      else if (c === '(') level++
      else if (c === ')' && --level === 0) {
        return [src.slice(from + 2, j), j + 1]
      }
    }
    return [src.slice(from + 2), src.length]
  }

  /** A variable after `$` at `from`; appends its value or marks the word dynamic. */
  const variable = (from: number): number => {
    let j = from + 1
    let name = ''
    if (src[j] === '{') {
      const close = src.indexOf('}', j)
      const end = close === -1 ? src.length : close
      name = src.slice(j + 1, end)
      j = close === -1 ? src.length : close + 1
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(:[A-Za-z_][A-Za-z0-9_]*)?/.exec(src.slice(j))
      if (m) {
        name = m[0]
        j += name.length
      } else {
        dynamic = true
        inWord = true
        return j + (j < src.length ? 1 : 0)
      }
    }
    const bare = name.replace(/^env:/i, '').toUpperCase()
    inWord = true
    if (HOME_NAMES.has(bare) && cx.home !== '') text += cx.home
    else {
      text += `$${name}`
      dynamic = true
    }
    return j
  }

  /** `%NAME%` at `from`, or -1 when there is none. */
  const percent = (from: number): number => {
    const m = /^%([A-Za-z_][A-Za-z0-9_]*)%/.exec(src.slice(from))
    if (!m) return -1
    inWord = true
    if (HOME_NAMES.has((m[1] as string).toUpperCase()) && cx.home !== '') text += cx.home
    else {
      text += m[0]
      dynamic = true
    }
    return from + m[0].length
  }

  let i = 0
  while (i < src.length) {
    const c = src[i] as string

    if (c === "'") {
      inWord = true
      const close = src.indexOf("'", i + 1)
      const end = close === -1 ? src.length : close
      text += src.slice(i + 1, end)
      i = end + 1
      continue
    }

    if (c === '"') {
      inWord = true
      i++
      while (i < src.length && src[i] !== '"') {
        const d = src[i] as string
        if (d === '$' && src[i + 1] === '(') {
          const [inner, next] = parens(i)
          substitute(inner)
          i = next
        } else if (d === '$') i = variable(i)
        else if (d === '%') {
          const next = percent(i)
          if (next === -1) {
            text += d
            i++
          } else i = next
        } else if (d === '`' && !isPs) {
          const close = src.indexOf('`', i + 1)
          const end = close === -1 ? src.length : close
          substitute(src.slice(i + 1, end))
          i = end + 1
        } else if ((d === '`' && isPs) || (d === '\\' && !isPs && '"\\$`'.includes(src[i + 1] ?? ' '))) {
          text += src[i + 1] ?? ''
          i += 2
        } else {
          text += d
          i++
        }
      }
      i++
      continue
    }

    if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
      continue
    }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      endCommand()
      i++
      continue
    }
    if (c === '<' || c === '>') {
      if (inWord && /^\d+$/.test(text)) {
        text = ''
        inWord = false
      }
      endWord()
      while (src[i] === '<' || src[i] === '>' || src[i] === '&') i++
      skipNext = true
      continue
    }
    if (c === '#' && !inWord) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '$' && src[i + 1] === '(') {
      const [inner, next] = parens(i)
      substitute(inner)
      i = next
      continue
    }
    if (c === '$') {
      i = variable(i)
      continue
    }
    if (c === '%') {
      const next = percent(i)
      if (next !== -1) {
        i = next
        continue
      }
    }
    if (c === '`') {
      if (isPs) {
        text += src[i + 1] ?? ''
        inWord = true
        i += 2
      } else {
        const close = src.indexOf('`', i + 1)
        const end = close === -1 ? src.length : close
        substitute(src.slice(i + 1, end))
        i = end + 1
      }
      continue
    }
    if (c === '\\' && !isPs) {
      const n = src[i + 1] ?? ''
      if (n !== '' && ' \t"\'$`\\;&|()<>*?[]{}!#~'.includes(n)) {
        text += n
        inWord = true
        i += 2
        continue
      }
      if (n === '\n') {
        i += 2
        continue
      }
    }
    if (c === '~' && !inWord && cx.home !== '') {
      const n = src[i + 1]
      if (n === undefined || n === '/' || n === '\\' || n === ' ' || n === '\t') {
        text += cx.home
        inWord = true
        i++
        continue
      }
    }
    text += c
    inWord = true
    i++
  }
  endCommand()
}

// -------------------------------------------------------------------- paths

/** Lower-cased, slash-separated, `.`/`..` folded, git-bash and WSL drives as `c:`. */
export function normalize(raw: string, cwd: string): { path: string; hasGlob: boolean } {
  let p = raw.replace(/\\/g, '/')
  const isUnc = p.startsWith('//')
  const isAbsolute = isUnc || p.startsWith('/') || /^[A-Za-z]:(\/|$)/.test(p)
  if (!isAbsolute) p = `${cwd.replace(/\\/g, '/')}/${p}`
  p = p.replace(/^\/mnt\/([A-Za-z])(\/|$)/, '$1:/').replace(/^\/([A-Za-z])(\/|$)/, '$1:/')

  const segments: string[] = []
  let hasGlob = false
  let head = ''
  const parts = p.split('/')
  if (/^[A-Za-z]:$/.test(parts[0] ?? '')) head = `${(parts.shift() as string).toLowerCase()}`
  else if (isUnc) head = '/'
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    if (/[*?[]/.test(part)) {
      hasGlob = true
      break
    }
    segments.push(part.toLowerCase())
  }
  return { path: head + '/' + segments.join('/'), hasGlob }
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

function depthOf(path: string): number {
  return path.split('/').filter(x => x !== '' && !/^[a-z]:$/.test(x)).length
}

/** Why a path is too dangerous to delete at all, or undefined. */
function catastrophic(path: string, home: string, cwd: string, isSearchRoot: boolean): string | undefined {
  const here = trimSlash(normalize(cwd, cwd).path)
  const mine = trimSlash(normalize(home === '' ? cwd : home, cwd).path)
  const covers = (outer: string, inner: string) =>
    outer === inner || outer === '/' || /^[a-z]:\/?$/.test(outer) || inner.startsWith(outer + '/')

  if (path === '/' || /^[a-z]:\/?$/.test(path)) return 'the root of a disk'
  if (depthOf(path) <= 1) return 'a top-level system folder'
  if (isSearchRoot) return undefined
  if (home !== '' && covers(path, mine)) return 'your home folder or a folder above it'
  if (covers(path, here)) return 'the project folder or a folder above it'
  if (path.split('/').pop() === '.git') return 'a .git folder'
  return undefined
}

/** The verdict for one deletion target. */
export function judgePath(word: Word, policy: Policy, isSearchRoot = false): Verdict {
  if (word.dynamic) {
    return { decision: 'ask', reason: `"${word.text}" is built from a variable or a substitution, so its real path is unknown` }
  }
  const { path, hasGlob } = normalize(word.text, policy.cwd)
  const base = trimSlash(path)
  const why = catastrophic(base, policy.home, policy.cwd, isSearchRoot)
  if (why !== undefined) {
    return { decision: 'deny', reason: `"${word.text}" is ${why}` }
  }
  for (const entry of policy.allow) {
    const allowed = trimSlash(normalize(entry, policy.cwd).path)
    if (base === allowed || base.startsWith(allowed + '/')) return { decision: 'allow' }
  }
  return { decision: 'ask', reason: `"${word.text}"${hasGlob ? ' (a pattern)' : ''} is outside allowPaths` }
}

// --------------------------------------------------------------------- judge

const RANK: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 }

function worst(a: Verdict, b: Verdict): Verdict {
  const targets = [...(a.targets ?? []), ...(b.targets ?? [])]
  return { ...(RANK[b.decision] > RANK[a.decision] ? b : a), targets }
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'fish', 'busybox'])
const PS_SHELLS = new Set(['powershell', 'pwsh'])
const PLAIN_WRAPPERS = new Set(['command', 'builtin', 'nohup', 'time', 'exec', 'setsid', 'stdbuf', 'nice', 'ionice', 'timeout', 'doas', 'sudo', 'env', 'wsl'])

/** Options of wrappers that take a value in the next word. */
const WRAPPER_VALUES: Record<string, ReadonlySet<string>> = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-T', '-r', '-t', '-U', '-D']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S']),
  nice: new Set(['-n']),
  ionice: new Set(['-c', '-n', '-p']),
  timeout: new Set(['-s', '-k']),
  wsl: new Set(['-d', '-u', '--distribution', '--user', '--cd']),
}

const XARGS_VALUES = new Set(['-I', '-n', '-P', '-d', '-E', '-L', '-l', '-s', '-a', '-J'])

const PS_PATH_PARAMS = new Set(['path', 'literalpath', 'pspath', 'lp', 'p'])
const PS_VALUE_PARAMS = new Set(['filter', 'include', 'exclude', 'credential', 'stream', 'i', 'e'])

function baseName(word: string): string {
  const last = word.replace(/\\/g, '/').split('/').pop() ?? word
  return last.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '')
}

/** Judges `command` as the Bash or PowerShell tool would run it. */
export function judge(command: string, policy: Policy): Verdict {
  let result: Verdict = { decision: 'allow', targets: [] }
  for (const words of tokenize(command, policy)) {
    result = worst(result, judgeWords(words, policy, 0, false))
  }
  return result
}

function judgeText(text: string, policy: Policy, depth: number, shell: Shell = policy.shell): Verdict {
  if (depth > MAX_DEPTH) {
    return { decision: 'ask', reason: 'the command is nested too deeply to read' }
  }
  const nested = { ...policy, shell }
  let result: Verdict = { decision: 'allow' }
  for (const words of tokenize(text, nested)) {
    result = worst(result, judgeWords(words, nested, depth + 1, false))
  }
  return result
}

function judgeWords(all: Word[], policy: Policy, depth: number, fromStdin: boolean): Verdict {
  if (depth > MAX_DEPTH) {
    return { decision: 'ask', reason: 'the command is nested too deeply to read' }
  }
  let at = 0
  while (at < all.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test((all[at] as Word).text)) at++
  const head = all[at]
  if (head === undefined) return { decision: 'allow' }
  const name = baseName(head.text)
  const rest = all.slice(at + 1)

  if (PLAIN_WRAPPERS.has(name)) {
    const values = WRAPPER_VALUES[name] ?? new Set<string>()
    let k = 0
    while (k < rest.length) {
      const w = (rest[k] as Word).text
      if (w === '--') {
        k++
        break
      }
      if (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) k++
      else if (w.startsWith('-') && w.length > 1) k += values.has(w) ? 2 : 1
      else break
    }
    if (name === 'timeout' && k < rest.length) k++
    return judgeWords(rest.slice(k), policy, depth + 1, fromStdin)
  }

  if (name === 'xargs') {
    let k = 0
    while (k < rest.length && (rest[k] as Word).text.startsWith('-')) {
      k += XARGS_VALUES.has((rest[k] as Word).text) ? 2 : 1
    }
    return judgeWords(rest.slice(k), policy, depth + 1, true)
  }

  if (name === 'eval') {
    return judgeText(rest.map(x => x.text).join(' '), policy, depth)
  }

  if (SHELLS.has(name)) {
    const flag = rest.findIndex(x => /^-[a-z]*c[a-z]*$/.test(x.text))
    const script = flag === -1 ? undefined : rest[flag + 1]
    return script === undefined ? { decision: 'allow' } : judgeText(script.text, policy, depth, 'bash')
  }

  if (name === 'cmd') {
    const flag = rest.findIndex(x => /^\/[ck]$/i.test(x.text))
    return flag === -1
      ? { decision: 'allow' }
      : judgeText(rest.slice(flag + 1).map(x => x.text).join(' '), policy, depth, 'bash')
  }

  if (PS_SHELLS.has(name)) {
    if (rest.some(x => /^-e(c|nc[a-z]*)?$/i.test(x.text))) {
      return { decision: 'ask', reason: 'an encoded PowerShell command cannot be read' }
    }
    const flag = rest.findIndex(x => /^-c(o(m(m(a(nd?)?)?)?)?)?$/i.test(x.text))
    return flag === -1
      ? { decision: 'allow' }
      : judgeText(rest.slice(flag + 1).map(x => x.text).join(' '), policy, depth, 'powershell')
  }

  if (name === 'find') return judgeFind(rest, policy, depth)

  if (policy.commands.has(name)) return judgeDeletion(name, rest, policy, fromStdin)

  return { decision: 'allow' }
}

function judgeFind(args: Word[], policy: Policy, depth: number): Verdict {
  let k = 0
  while (k < args.length && /^-[HLP]$|^-[DO]/.test((args[k] as Word).text)) k++
  const roots: Word[] = []
  while (k < args.length && !/^[-(!]/.test((args[k] as Word).text)) roots.push(args[k++] as Word)

  let result: Verdict = { decision: 'allow' }
  let deletes = false
  for (; k < args.length; k++) {
    const text = (args[k] as Word).text
    if (text === '-delete') deletes = true
    else if (/^-(exec|execdir|ok|okdir)$/.test(text)) {
      const inner: Word[] = []
      for (k++; k < args.length; k++) {
        const w = (args[k] as Word).text
        if (w === ';' || w === '+') break
        inner.push(args[k] as Word)
      }
      result = worst(result, judgeWords(inner, policy, depth + 1, true))
    }
  }
  if (deletes && policy.commands.has('find')) {
    const targets = roots.length > 0 ? roots : [{ text: '.', dynamic: false }]
    for (const root of targets) {
      const v = judgePath(root, policy, true)
      if (v.decision === 'allow') continue
      result = worst(result, {
        decision: v.decision,
        reason: `find -delete under ${v.reason ?? root.text}`,
        targets: [{ text: root.text, dynamic: root.dynamic, kind: 'search' }],
      })
    }
  }
  return result
}

function judgeDeletion(name: string, args: Word[], policy: Policy, fromStdin: boolean): Verdict {
  const powershell = name === 'remove-item' || name === 'ri' || policy.shell === 'powershell'
  const windows = name === 'del' || name === 'erase' || name === 'rd' || name === 'rmdir'
  const targets: Word[] = []
  const add = (w: Word) => {
    const parts = powershell && !w.dynamic ? w.text.split(',') : [w.text]
    for (const part of parts) if (part !== '') targets.push({ text: part, dynamic: w.dynamic })
  }

  let ended = false
  for (let k = 0; k < args.length; k++) {
    const w = args[k] as Word
    const t = w.text
    if (ended) add(w)
    else if (t === '--' && !powershell) ended = true
    else if (powershell && /^-[A-Za-z]+(:.*)?$/.test(t)) {
      const m = /^-([A-Za-z]+)(?::(.*))?$/.exec(t) as RegExpExecArray
      const param = (m[1] as string).toLowerCase()
      if (PS_PATH_PARAMS.has(param)) {
        const value = m[2] !== undefined ? { text: m[2], dynamic: w.dynamic } : args[++k]
        if (value !== undefined) add(value)
      } else if (PS_VALUE_PARAMS.has(param) && m[2] === undefined) k++
    } else if (t.startsWith('-') && t.length > 1) {
      if (name === 'shred' && /^(-n|-s|--iterations|--size|--random-source)$/.test(t)) k++
    } else if (windows && /^(\/[A-Za-z?])+$/.test(t)) {
      continue
    } else add(w)
  }
  const shown: Target[] = targets.map(t => ({ text: t.text, dynamic: t.dynamic }))
  if (fromStdin) {
    targets.push({ text: 'paths from another command', dynamic: true })
    shown.push({ text: '', dynamic: true, kind: 'stdin' })
  }

  if (targets.length === 0) {
    return { decision: 'ask', reason: `${name} names no path that can be checked` }
  }
  let result: Verdict = { decision: 'allow' }
  for (const target of targets) result = worst(result, judgePath(target, policy))
  if (result.decision === 'allow') return result
  return { decision: result.decision, reason: `${name}: ${result.reason ?? 'not allowed'}`, targets: shown }
}

/** A target as the person should read it: relative paths made absolute from the project folder. */
export function display(text: string, cwd: string): string {
  if (/^([A-Za-z]:[\\/]|\/|\\\\|~)/.test(text)) return text
  const separator = cwd.includes('\\') ? '\\' : '/'
  const rest = text.replace(/^\.[\\/]/, '').replace(/[\\/]/g, separator)
  return `${cwd.replace(/[\\/]+$/, '')}${separator}${rest}`
}
