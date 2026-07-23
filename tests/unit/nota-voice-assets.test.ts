import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

interface VoiceAsset {
  file: string;
  prompt: string;
  sha256: string;
}

interface VoiceManifest {
  format: string;
  model: {
    name: string;
    revision: string;
    url: string;
  };
  dataset: {
    name: string;
    url: string;
  };
  clips: VoiceAsset[];
}

const assetRoot = resolve(process.cwd(), 'public/assets/nota-voice');
const manifestPath = resolve(assetRoot, 'manifest.json');

function sha256(contents: Buffer) {
  return createHash('sha256').update(contents).digest('hex');
}

describe('bundled Nota voice assets', () => {
  test('contains the pinned offline provenance and exactly 501 declared Ogg clips', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VoiceManifest;

    expect(manifest.format).toBe('Ogg/Opus mono');
    expect(manifest.model).toEqual({
      name: 'grandhigh/Chatterbox-TTS-Indonesian',
      revision: '4224700012365780cf891af53bd839412d3e18fd',
      url: 'https://huggingface.co/grandhigh/Chatterbox-TTS-Indonesian',
    });
    expect(manifest.dataset).toEqual({
      name: 'grandhigh/SuaraGabungan-ID',
      url: 'https://huggingface.co/datasets/grandhigh/SuaraGabungan-ID',
    });
    expect(manifest.clips).toHaveLength(501);
    expect(new Set(manifest.clips.map((clip) => clip.file)).size).toBe(501);
  });

  test('covers every supported row, PCS quantity, and LSN quantity with a valid checksum', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VoiceManifest;
    const expectedRows = [...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)), 'AA']
      .flatMap((suffix) => Array.from({ length: 15 }, (_, index) => `rows/${index + 1}${suffix}.ogg`));
    const expectedQuantities = (['pcs', 'lsn'] as const)
      .flatMap((unit) => Array.from({ length: 48 }, (_, index) => `quantities/${unit}/${index + 1}.ogg`));

    expect(manifest.clips.map((clip) => clip.file).sort()).toEqual([...expectedRows, ...expectedQuantities].sort());

    for (const clip of manifest.clips) {
      expect(clip.prompt.trim()).not.toBe('');
      const contents = readFileSync(resolve(assetRoot, clip.file));
      expect(contents.subarray(0, 4).toString('ascii')).toBe('OggS');
      expect(contents.length).toBeGreaterThan(500);
      expect(clip.sha256).toBe(sha256(contents));
    }
  });

  test('does not bundle source WAV, model checkpoints, Python, or CUDA artifacts', () => {
    const files = readdirSync(assetRoot, { recursive: true })
      .map(String)
      .filter((entry) => !entry.endsWith('/'));

    expect(files).toContain('NOTICE.txt');
    expect(files.some((file) => /\.(wav|pt|pth|ckpt|safetensors|py)$/i.test(file))).toBe(false);
  });
});
