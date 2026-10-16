import { describe, expect, it } from 'vitest';
import { LABS } from '../../src/domain/lab';
import { contrastRatio, hexToRgb, luminance } from '../../src/ui/contrast';
import { LINE_BULLETS, lineBullet, lineName, serviceName } from '../../src/ui/lines';
import { PALETTE } from '../../src/ui/palette';

describe('contrast', () => {
  it('computes WCAG ratios from either hex form, symmetrically', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('0039A6')).toEqual([0, 57, 166]);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBe(1);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777', '#777')).toBe(1);
    expect(() => hexToRgb('orange')).toThrow(/not a hex colour/);
  });
});

describe('line bullets', () => {
  it('gives every lab in the registry a bullet, each with its own letter and its own colour', () => {
    expect(Object.keys(LINE_BULLETS).sort()).toEqual(LABS.map((l) => l.id).sort());
    const letters = Object.values(LINE_BULLETS).map((b) => b.letter);
    const fills = Object.values(LINE_BULLETS).map((b) => b.fill.toLowerCase());
    expect(new Set(letters).size).toBe(letters.length);
    expect(new Set(fills).size).toBe(fills.length);
    for (const b of Object.values(LINE_BULLETS)) expect(b.letter).toMatch(/^[A-Z]$/);
  });

  for (const [id, b] of Object.entries(LINE_BULLETS)) {
    it(`sets ${id}'s letter at 4.5:1 or better on its disc`, () => {
      expect(contrastRatio(b.ink, b.fill)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("uses each lab's initial where it is free", () => {
    for (const l of LABS) {
      const b = LINE_BULLETS[l.id];
      if (['mistral', 'moonshot'].includes(l.id)) continue;
      expect(l.name.toUpperCase()).toContain(b.letter);
    }
    expect(LINE_BULLETS.mistral.letter).toBe('W');
    expect(LINE_BULLETS.moonshot.letter).toBe('K');
  });

  it('falls back to an ink disc with the first letter for an id outside the registry', () => {
    expect(lineBullet('anthropic')).toBe(LINE_BULLETS.anthropic);
    expect(lineBullet('newlab')).toEqual({ letter: 'N', fill: PALETTE.ink, ink: '#ffffff' });
    expect(lineBullet('').letter).toBe('?');
  });
});

describe('line and service names', () => {
  it('calls a lab a line', () => {
    expect(lineName('Anthropic')).toBe('Anthropic line');
  });

  it('prints a family as its service: no "Next", no version floor', () => {
    expect(serviceName('Next Claude Haiku (4.6+)')).toBe('Claude Haiku');
    expect(serviceName('Next Z.ai GLM (5.4+)')).toBe('Z.ai GLM');
    expect(serviceName('Gemini 4.0')).toBe('Gemini 4.0');
    expect(serviceName('GPT Astra 6.1+')).toBe('GPT Astra 6.1+');
    expect(serviceName('Next')).toBe('Next');
  });
});

describe('palette', () => {
  it('declares the same values as CSS tokens in global.css', async () => {
    // Vitest hands a CSS import back empty, so read the file itself.
    // @ts-ignore This app deliberately does not ship Node type declarations; vitest runs in Node.
    const { readFile } = await import('node:fs/promises');
    const css = await readFile(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const [token, value] of Object.entries(PALETTE)) {
      const declared = new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(root)?.[1];
      expect(declared?.toLowerCase(), `--${token}`).toBe(value);
    }
  });

  it('holds running text to 7:1: ink and ink-2 on paper, both sign inks on the sign', () => {
    expect(contrastRatio(PALETTE.ink, PALETTE.paper)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(PALETTE['ink-2'], PALETTE.paper)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(PALETTE['ink-2'], PALETTE['paper-2'])).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(PALETTE['sign-ink'], PALETTE.sign)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(PALETTE['sign-ink-2'], PALETTE.sign)).toBeGreaterThanOrEqual(7);
  });
});
