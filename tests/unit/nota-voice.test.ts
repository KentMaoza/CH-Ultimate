import { describe, expect, test, vi } from 'vitest';
import { createNotaVoicePlayer, resolveNotaVoice, type NotaVoiceAudio, type NotaVoiceRequest } from '../../src/renderer/nota/nota-voice';

function request(overrides: Partial<NotaVoiceRequest> = {}): NotaVoiceRequest {
  return { rowNumber: 1, suffix: 'A', quantity: 1, unit: 'pcs', ...overrides };
}

function createAudio(url: string) {
  return {
    url,
    currentTime: 0,
    onended: null as ((event: Event) => void) | null,
    onerror: null as OnErrorEventHandler,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  };
}

async function expectCancelledPlayRejectionToBeIgnored(
  cancelPlayback: (player: ReturnType<typeof createNotaVoicePlayer>) => void,
) {
  let rejectPlay!: (error: Error) => void;
  let clipIndex = 0;
  const onPlaybackError = vi.fn();
  const player = createNotaVoicePlayer({
    audioFactory: (url) => {
      const clip = createAudio(url);
      if (clipIndex === 0) {
        clip.play.mockImplementation(() => new Promise<void>((_resolve, reject) => {
          rejectPlay = reject;
        }));
      }
      clipIndex += 1;
      return clip;
    },
    onPlaybackError,
  });

  player.speak(request());
  cancelPlayback(player);
  rejectPlay(new Error('Playback was interrupted'));
  await Promise.resolve();

  expect(onPlaybackError).not.toHaveBeenCalled();
}

describe('nota voice', () => {
  test('resolves only supported row and quantity requests to their two local clips', () => {
    expect(resolveNotaVoice(request({ rowNumber: 15, suffix: 'AA', quantity: 48, unit: 'lsn' }))).toEqual([
      './assets/nota-voice/rows/15AA.ogg',
      './assets/nota-voice/quantities/lsn/48.ogg',
    ]);
    expect(resolveNotaVoice(request({ rowNumber: 16 }))).toBeNull();
    expect(resolveNotaVoice(request({ suffix: 'AB' }))).toBeNull();
    expect(resolveNotaVoice(request({ quantity: 0 }))).toBeNull();
    expect(resolveNotaVoice({ ...request(), quantity: 1.5 })).toBeNull();
  });

  test('resolves clips beside the packaged file renderer instead of the filesystem root', () => {
    const clips = resolveNotaVoice(request());
    expect(clips).not.toBeNull();
    expect(new URL(clips![0], 'file:///Applications/CH%20Ultimate.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html').href)
      .toBe('file:///Applications/CH%20Ultimate.app/Contents/Resources/app.asar/.vite/renderer/main_window/assets/nota-voice/rows/1A.ogg');
  });

  test('replaces the current sequence and plays the two newest clips in order', () => {
    const clips: ReturnType<typeof createAudio>[] = [];
    const playedUrls: string[] = [];
    const player = createNotaVoicePlayer({ audioFactory: (url) => {
      const clip = createAudio(url);
      clip.play.mockImplementation(() => {
        playedUrls.push(url);
        return Promise.resolve();
      });
      clips.push(clip);
      return clip;
    } });

    player.speak(request());
    player.speak(request({ rowNumber: 2, suffix: 'B', quantity: 3, unit: 'lsn' }));

    expect(clips[0]!.pause).toHaveBeenCalledOnce();
    expect(clips[1]!.url).toBe('./assets/nota-voice/rows/2B.ogg');
    expect(clips[1]!.play).toHaveBeenCalledOnce();
    expect(playedUrls).toEqual(['./assets/nota-voice/rows/1A.ogg', './assets/nota-voice/rows/2B.ogg']);
    clips[0]!.onended?.(new Event('ended'));
    expect(clips).toHaveLength(2);
    clips[1]!.onended?.(new Event('ended'));
    expect(clips[2]!.url).toBe('./assets/nota-voice/quantities/lsn/3.ogg');
    expect(clips[2]!.play).toHaveBeenCalledOnce();
    expect(playedUrls.slice(1)).toEqual([
      './assets/nota-voice/rows/2B.ogg',
      './assets/nota-voice/quantities/lsn/3.ogg',
    ]);
  });

  test('cancels active playback, exposes the standard test request, and prevents playback after disposal', () => {
    const clips: ReturnType<typeof createAudio>[] = [];
    const player = createNotaVoicePlayer({ audioFactory: (url) => {
      const clip = createAudio(url);
      clips.push(clip);
      return clip;
    } });

    player.test();
    expect(clips[0]!.url).toBe('./assets/nota-voice/rows/1A.ogg');
    player.cancel();
    expect(clips[0]!.pause).toHaveBeenCalledOnce();
    player.test();
    player.dispose();
    expect(clips[1]!.pause).toHaveBeenCalledOnce();
    player.speak(request({ rowNumber: 2 }));
    expect(clips).toHaveLength(2);
  });

  test('reports playback failures without throwing', async () => {
    const onPlaybackError = vi.fn();
    const failedClip: NotaVoiceAudio = { onended: null, onerror: null, play: vi.fn(() => Promise.reject(new Error('Audio blocked'))), pause: vi.fn() };
    const player = createNotaVoicePlayer({ audioFactory: () => failedClip, onPlaybackError });

    expect(() => player.speak(request())).not.toThrow();
    await Promise.resolve();
    expect(onPlaybackError).toHaveBeenCalledWith(expect.any(Error));
  });

  test('ignores a play rejection after cancellation', async () => {
    await expectCancelledPlayRejectionToBeIgnored((player) => player.cancel());
  });

  test('ignores a play rejection after replacement', async () => {
    await expectCancelledPlayRejectionToBeIgnored((player) => player.speak(request({ rowNumber: 2 })));
  });

  test('ignores a play rejection after disposal', async () => {
    await expectCancelledPlayRejectionToBeIgnored((player) => player.dispose());
  });

  test('reports active audio error events and ignores errors from cancelled sequences', async () => {
    const clips: ReturnType<typeof createAudio>[] = [];
    const onPlaybackError = vi.fn();
    const player = createNotaVoicePlayer({ audioFactory: (url) => {
      const clip = createAudio(url);
      clips.push(clip);
      return clip;
    }, onPlaybackError });

    player.speak(request());
    player.speak(request({ rowNumber: 2, suffix: 'B', quantity: 3, unit: 'lsn' }));
    clips[0]!.onerror?.(new Event('error'));
    expect(onPlaybackError).not.toHaveBeenCalled();
    expect(clips).toHaveLength(2);

    const activeError = new Event('error');
    await Promise.resolve();
    clips[1]!.onerror?.(activeError);
    expect(onPlaybackError).toHaveBeenCalledWith(activeError);
    expect(clips).toHaveLength(2);
  });

  test('reports a throwing audio factory without throwing', () => {
    const factoryError = new Error('Audio unavailable');
    const onPlaybackError = vi.fn();
    const player = createNotaVoicePlayer({ audioFactory: () => { throw factoryError; }, onPlaybackError });

    expect(() => player.speak(request())).not.toThrow();
    expect(onPlaybackError).toHaveBeenCalledWith(factoryError);
  });

  test('reports failures while stopping audio without throwing', () => {
    const onPlaybackError = vi.fn();
    const player = createNotaVoicePlayer({
      audioFactory: () => ({ onended: null, onerror: null, play: vi.fn(() => Promise.resolve()), pause: vi.fn(() => { throw new Error('Pause blocked'); }) }),
      onPlaybackError,
    });

    player.speak(request());
    expect(() => player.cancel()).not.toThrow();
    expect(onPlaybackError).toHaveBeenCalledWith(expect.any(Error));
  });
});
