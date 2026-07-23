export interface NotaVoiceRequest {
  rowNumber: number;
  suffix: string;
  quantity: number;
  unit: 'pcs' | 'lsn';
}

export interface NotaVoiceAudio {
  onended: ((event: Event) => void) | null;
  onerror: OnErrorEventHandler;
  play(): Promise<void> | void;
  pause(): void;
}

export type NotaVoiceAudioFactory = (url: string) => NotaVoiceAudio;

export interface NotaVoicePlayerOptions {
  audioFactory?: NotaVoiceAudioFactory;
  onPlaybackError?: (error: unknown) => void;
}

export interface NotaVoicePlayer {
  speak(request: NotaVoiceRequest): void;
  cancel(): void;
  test(): void;
  dispose(): void;
}

const suffixes = new Set([...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)), 'AA']);

export function resolveNotaVoice(request: NotaVoiceRequest): [string, string] | null {
  if (!Number.isInteger(request.rowNumber) || request.rowNumber < 1 || request.rowNumber > 15) return null;
  if (!suffixes.has(request.suffix)) return null;
  if (!Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 48) return null;
  if (request.unit !== 'pcs' && request.unit !== 'lsn') return null;
  return [
    `./assets/nota-voice/rows/${request.rowNumber}${request.suffix}.ogg`,
    `./assets/nota-voice/quantities/${request.unit}/${request.quantity}.ogg`,
  ];
}

const browserAudioFactory: NotaVoiceAudioFactory = (url) => new Audio(url);

export function createNotaVoicePlayer({ audioFactory = browserAudioFactory, onPlaybackError }: NotaVoicePlayerOptions = {}): NotaVoicePlayer {
  let activeAudio: NotaVoiceAudio | null = null;
  let sequence = 0;
  let disposed = false;

  const reportPlaybackError = (error: unknown) => {
    try {
      onPlaybackError?.(error);
    } catch {
      // Playback reporting must not alter renderer behavior.
    }
  };

  const cancel = () => {
    sequence += 1;
    try {
      activeAudio?.pause();
    } catch (error) {
      reportPlaybackError(error);
    }
    activeAudio = null;
  };

  const speak = (request: NotaVoiceRequest) => {
    if (disposed) return;
    cancel();
    const clips = resolveNotaVoice(request);
    if (!clips) return;
    const currentSequence = sequence;

    const playClip = (index: number) => {
      if (disposed || currentSequence !== sequence) return;
      let audio: NotaVoiceAudio;
      try {
        audio = audioFactory(clips[index]!);
      } catch (error) {
        reportPlaybackError(error);
        return;
      }
      activeAudio = audio;
      audio.onended = () => {
        if (index + 1 < clips.length) playClip(index + 1);
      };
      audio.onerror = (event) => {
        if (!disposed && currentSequence === sequence && activeAudio === audio) reportPlaybackError(event);
      };
      try {
        void Promise.resolve(audio.play()).catch((error) => {
          if (!disposed && currentSequence === sequence && activeAudio === audio) reportPlaybackError(error);
        });
      } catch (error) {
        reportPlaybackError(error);
      }
    };

    playClip(0);
  };

  return {
    speak,
    cancel,
    test: () => speak({ rowNumber: 1, suffix: 'A', quantity: 1, unit: 'pcs' }),
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}
