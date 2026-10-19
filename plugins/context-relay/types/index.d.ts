/**
 * context-relay: the values the mod keeps in `$.state`, all under its own
 * name. Everything a drawing reads lives here; module variables hold nothing
 * a hot reload may lose.
 */

/** One context reading, taken after a main-loop turn. */
export type ContextRelayReading = {
  /** When it was taken, ms since the epoch. */
  at: number;
  /** Input tokens of the last response, cached included. */
  tokens: number;
  /** The model's context window, in tokens. */
  window: number;
  /** True for the reading right after a compaction (its bar draws as 0). */
  isCompaction?: true;
};

/** The weather band a reading falls in. */
export type ContextRelayBand = 'clear' | 'overcast' | 'rain' | 'storm';

/** The prompt cache as the mod tracks it. */
export type ContextRelayCache = {
  /** When the last main-loop request (or warm-up ping) was made; null before the first. */
  requestAt: number | null;
  /** The cache TTL in ms: 5 minutes or 1 hour. */
  ttlMs: number;
  /** Warm-up pings sent during the current idle period. */
  pings: number;
  /** When the next automatic ping is due, or null while no chain runs. */
  nextPingAt: number | null;
  /** True while a ping is in flight. */
  isPinging: boolean;
  /** The share of the last turn's prompt the cache served, 0..100; null before the first turn. */
  hitPercent: number | null;
};

/** One subagent of this session. */
export type ContextRelayAgent = {
  id: string;
  /** The Agent call's short description. */
  name: string;
  /** The agent type (`Explore`, `general-purpose`, ...). */
  type: string;
  startedAt: number;
  /** Set when its loop finished. */
  endedAt?: number;
};

/** One background command of this session: a Bash call that went to the background. */
export type ContextRelayTask = {
  /**
   * The call's tool_use_id; once the command goes to the background, the
   * engine's task id, as its notification carries it.
   */
  id: string;
  /** The call's description, or the command line cut short. */
  name: string;
  startedAt: number;
  /** Set when the call answered, or when the background task's notification arrived. */
  endedAt?: number;
  /** `completed`, `failed`, `interrupted`, `denied`, or the notification's own status. */
  status?: string;
};

/** Where the handoff flow stands. */
export type ContextRelayHandoffPhase =
  | 'idle'
  | 'countdown'
  | 'collecting'
  | 'clearing'
  | 'armed';

export type ContextRelayHandoff = {
  phase: ContextRelayHandoffPhase;
  /** The countdown's end, ms since the epoch, while `phase` is `countdown`. */
  countdownEndsAt: number | null;
  /** A handoff found at session start that waits for the Load press. */
  pending: ContextRelayPendingHandoff | null;
  /** The last error the flow hit, shown once in the band. */
  error: string | null;
};

/** The pointer to a handoff file, as `$.store` keeps it between sessions. */
export type ContextRelayPendingHandoff = {
  /** The handoff file's absolute path. */
  file: string;
  /** The handoff text (the file's content). */
  text: string;
  /** When it was collected, ms since the epoch. */
  createdAt: number;
  /** True once the person (or the mod's own clear) asked for it to be loaded. */
  isArmed: boolean;
};

export type ContextRelayLanguage = 'en' | 'ru';

declare module 'claude-code' {
  interface PluginState {
    'context-relay': {
      /** The last 13 readings, oldest first. */
      readings: ContextRelayReading[];
      cache: ContextRelayCache;
      agents: ContextRelayAgent[];
      tasks: ContextRelayTask[];
      /** Session cost in USD, and the last turn's share. */
      cost: { usd: number; lastUsd: number };
      handoff: ContextRelayHandoff;
      /** The system's language; the desktop draws in it, the terminal in English. */
      lang: ContextRelayLanguage;
      /** True once the Storm toast was shown; reset when the band drops below Storm. */
      stormToasted: boolean;
      /** Terminal only: the details rows are shown under the band. */
      isExpanded: boolean;
      /** Bumped by the 30-second ticker so timers redraw. */
      tick: number;
    };
  }
}
