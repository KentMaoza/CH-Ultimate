import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

function pngDimensions(contents: Buffer) {
  expect(contents.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

describe('CH Ultimate branding assets', () => {
  it('keeps the packaged desktop icon alongside the CH Core resources', async () => {
    const config = await readFile('forge.config.ts', 'utf8');
    expect(config).toContain("icon: 'assets/brand/ch-ultimate-icon'");
    expect(config).toContain("'resources/ch-core-deployment.json'");
    expect(config).toContain("'resources/ch-core-ca.pem'");
  });

  it('ships safe static renderer marks', async () => {
    const mark = await readFile('public/brand/ch-ultimate-mark.svg', 'utf8');
    expect(mark).toContain('<svg');
    expect(mark).not.toMatch(/<script|javascript:|<foreignObject/i);
  });

  it('uses the required Android launcher dimensions at every density', async () => {
    const expected = {
      mdpi: { launcher: 48, foreground: 108 },
      hdpi: { launcher: 72, foreground: 162 },
      xhdpi: { launcher: 96, foreground: 216 },
      xxhdpi: { launcher: 144, foreground: 324 },
      xxxhdpi: { launcher: 192, foreground: 432 },
    } as const;

    for (const [density, sizes] of Object.entries(expected)) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        const contents = await readFile(
          `android/app/src/main/res/mipmap-${density}/${name}`,
        );
        expect(pngDimensions(contents)).toEqual({
          width: sizes.launcher,
          height: sizes.launcher,
        });
      }

      const foreground = await readFile(
        `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
      );
      expect(pngDimensions(foreground)).toEqual({
        width: sizes.foreground,
        height: sizes.foreground,
      });
    }
  });
});
