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
  sourceSampleRateHz: number;
  engine: {
    name: string;
    version: string;
    url: string;
  };
  model: {
    name: string;
    revision: string;
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
  test('contains the pinned offline Piper provenance and exactly 1,505 declared Ogg clips', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VoiceManifest;

    expect(manifest.format).toBe('Ogg/Opus mono');
    expect(manifest.sourceSampleRateHz).toBe(22050);
    expect(manifest.engine).toEqual({
      name: 'OHF-Voice/piper1-gpl',
      version: '1.4.2',
      url: 'https://github.com/OHF-Voice/piper1-gpl',
    });
    expect(manifest.model).toEqual({
      name: 'rhasspy/piper-voices/id_ID-news_tts-medium',
      revision: '5b44ec7bab7c5822cfec48fbd5aa99db71a823d6',
      url: 'https://huggingface.co/rhasspy/piper-voices/tree/5b44ec7bab7c5822cfec48fbd5aa99db71a823d6/id/id_ID/news_tts/medium',
    });
    expect(manifest.clips).toHaveLength(1_505);
    expect(new Set(manifest.clips.map((clip) => clip.file)).size).toBe(1_505);
  });

  test('covers every supported row, quantity, and compositional price segment with a valid checksum', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VoiceManifest;
    const expectedRows = [...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)), 'AA']
      .flatMap((suffix) => Array.from({ length: 15 }, (_, index) => `rows/${index + 1}${suffix}.ogg`));
    const expectedQuantities = (['pcs', 'lsn'] as const)
      .flatMap((unit) => Array.from({ length: 48 }, (_, index) => `quantities/${unit}/${index + 1}.ogg`));
    const expectedPriceValues = Array.from({ length: 999 }, (_, index) => `prices/values/${index + 1}.ogg`);
    const expectedPriceConnectors = [
      'prices/harga.ogg',
      'prices/seribu.ogg',
      'prices/ribu.ogg',
      'prices/satu-juta.ogg',
      'prices/rupiah.ogg',
    ];

    expect(manifest.clips.map((clip) => clip.file).sort()).toEqual([
      ...expectedRows,
      ...expectedQuantities,
      ...expectedPriceValues,
      ...expectedPriceConnectors,
    ].sort());

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
