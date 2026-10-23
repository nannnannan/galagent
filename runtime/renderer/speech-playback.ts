import type { GalAgentBridge } from '../shared/contracts';

type SpeechResult = Awaited<ReturnType<NonNullable<GalAgentBridge['synthesizeSpeech']>>>;

/** One owner for pending synthesis and playback. A newer utterance supersedes the old one. */
export class SpeechPlayback {
  private revision = 0;
  constructor(private hooks: {
    synthesize(text: string): Promise<SpeechResult>;
    play(result: SpeechResult, text: string, current: () => boolean): Promise<void>;
    stop(): void;
    cancel(): void;
  }) {}
  stop(cancelRequest = true) {
    this.revision++;
    this.hooks.stop();
    if (cancelRequest) this.hooks.cancel();
  }
  async speak(text: string): Promise<string | undefined> {
    if (!text.trim()) return;
    this.stop();
    const revision = this.revision;
    const current = () => revision === this.revision;
    try {
      const result = await this.hooks.synthesize(text.trim());
      if (!current()) return;
      if (!result.ok) return result.error || '语音合成未完成。';
      await this.hooks.play(result, text.trim(), current);
    } catch (error) {
      if (current()) return error instanceof Error ? error.message : '语音合成暂时不可用。';
    }
  }
}
