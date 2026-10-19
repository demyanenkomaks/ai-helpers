/**
 * rm-guard: the one value the mod keeps in `$.state`, under its own name.
 * The confirmation pane draws from it; module variables hold nothing a hot
 * reload may lose except the pressed-button callbacks, which cannot be state.
 */

/** The deletion the person is being asked about, as the pane draws it. */
export type RmGuardAsking = {
  /** Tells one question from the next, so a stale button press is ignored. */
  id: number;
  /** One line per path that would go, already worded and translated. */
  items: string[];
  /** The command as the agent wrote it, cut to a readable length. */
  command: string;
  language: 'en' | 'ru';
};

declare module 'claude-code' {
  interface PluginState {
    'rm-guard': { asking: RmGuardAsking | null };
  }
}
