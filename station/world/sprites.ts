import type { Direction, Role } from './crew';

type Appearance = {
  skin: string;
  skinLight: string;
  hair: string;
  hairLight: string;
  coat: string;
  light: string;
  dark: string;
};
const appearances: Record<Role, Appearance> = {
  captain: {
    skin: '#e1a77e',
    skinLight: '#ffd1a0',
    hair: '#884b34',
    hairLight: '#c27d4c',
    coat: '#b6793e',
    light: '#f0c478',
    dark: '#694a32',
  },
  scout: {
    skin: '#d19c6e',
    skinLight: '#f0c99a',
    hair: '#393d3e',
    hairLight: '#626960',
    coat: '#467f68',
    light: '#8ac899',
    dark: '#2d544b',
  },
  mapper: {
    skin: '#95604d',
    skinLight: '#cb9270',
    hair: '#292f3e',
    hairLight: '#42485b',
    coat: '#477d9e',
    light: '#8fc5d0',
    dark: '#2d4b67',
  },
  analyst: {
    skin: '#e9b9a0',
    skinLight: '#ffe0b6',
    hair: '#5b496f',
    hairLight: '#9581a7',
    coat: '#77718c',
    light: '#b3b1c1',
    dark: '#4d485e',
  },
  reviewer: {
    skin: '#bc876a',
    skinLight: '#e9b99a',
    hair: '#98492e',
    hairLight: '#d5824b',
    coat: '#a86452',
    light: '#e59a74',
    dark: '#693e3d',
  },
  scribe: {
    skin: '#dfa986',
    skinLight: '#ffcfaa',
    hair: '#b4b1a3',
    hairLight: '#ebe1c5',
    coat: '#73835c',
    light: '#b7c18a',
    dark: '#424d42',
  },
};

const cache = new Map<string, HTMLCanvasElement>();

/** Original 24 × 36 pixel characters. Shared anatomy keeps every direction and frame aligned. */
export function sprite(
  role: Role,
  direction: Direction = 'south',
  frame = 0,
  action: 'idle' | 'walk' | 'work' = 'idle',
) {
  const key = `${role}:${direction}:${frame}:${action}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 36;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const p = appearances[role];
  const outline = '#252b35';
  const bob = action === 'walk' && frame % 2 ? -1 : 0;
  const stride = action === 'walk' ? [0, 2, 0, -2][frame % 4] : 0;
  const r = (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x, y + bob, w, h);
  };
  if (direction === 'west') {
    c.translate(24, 0);
    c.scale(-1, 1);
  }
  const side = direction === 'east' || direction === 'west';
  // Boots, trouser cuffs, shaped shoulders, and hand silhouettes.
  r(6, 28 + Math.max(0, stride), 5, 5 - Math.max(0, stride), outline);
  r(13, 28 + Math.max(0, -stride), 5, 5 - Math.max(0, -stride), outline);
  r(5, 32, 6, 2, '#3c3440');
  r(13, 32, 7, 2, '#3c3440');
  r(6, 27, 5, 3, '#555363');
  r(13, 27, 5, 3, '#555363');
  r(7, 30, 3, 1, '#8c7b6f');
  r(14, 30, 3, 1, '#8c7b6f');
  r(7, 17, 10, 1, outline);
  r(5, 18, 14, 8, outline);
  r(6, 25, 12, 3, outline);
  r(6, 19, 12, 7, p.coat);
  r(8, 18, 8, 9, p.coat);
  r(7, 19, 3, 7, p.light);
  r(15, 20, 3, 6, p.dark);
  r(7, 26, 11, 2, p.dark);
  const handLift = action === 'work' ? (frame % 2 ? 4 : 2) : 0;
  r(3, 19 - (stride > 0 ? 1 : 0), 3, 7 - handLift, outline);
  r(4, 20 - (stride > 0 ? 1 : 0), 2, 4 - handLift / 2, p.coat);
  r(3, 25 - handLift, 3, 3, p.skin);
  r(4, 25 - handLift, 2, 1, p.skinLight);
  r(18, 19 + (stride > 0 ? 1 : 0), 3, 7 - handLift, outline);
  r(18, 20 + (stride > 0 ? 1 : 0), 2, 4 - handLift / 2, p.light);
  r(18, 25 - handLift, 3, 3, p.skin);
  r(18, 25 - handLift, 2, 1, p.skinLight);
  // Neck, ears and a rounded face made from individual pixel clusters.
  r(9, 15, 6, 4, p.skin);
  r(10, 16, 4, 2, p.skinLight);
  r(7, 4, 10, 1, outline);
  r(5, 5, 14, 8, outline);
  r(6, 12, 12, 3, outline);
  r(8, 15, 8, 1, outline);
  r(6, 7, 12, 6, p.skin);
  r(8, 6, 9, 8, p.skinLight);
  r(9, 14, 6, 2, p.skin);
  r(4, 10, 2, 3, p.skin);
  r(18, 10, 2, 3, p.skin);
  r(6, 4, 12, 4, p.hair);
  r(8, 3, 9, 3, p.hair);
  r(5, 6, 2, 5, p.hair);
  r(7, 4, 3, 2, p.hairLight);
  r(10, 3, 5, 1, p.hairLight);
  if (direction === 'north') {
    r(6, 7, 12, 7, p.hair);
    r(8, 14, 8, 2, p.hair);
    r(7, 8, 2, 4, p.hairLight);
    r(9, 20, 6, 5, p.dark);
    r(10, 20, 4, 3, p.light);
  } else if (side) {
    r(6, 5, 7, 10, p.hair);
    r(7, 7, 3, 5, p.hairLight);
    r(17, 10, 3, 2, p.skinLight);
    r(15, 9, 1, 2, outline);
    r(17, 14, 2, 1, '#a55d53');
  } else {
    r(8, 9, 2, frame === 3 && action === 'idle' ? 1 : 2, outline);
    r(15, 9, 2, frame === 3 && action === 'idle' ? 1 : 2, outline);
    r(11, 12, 2, 1, p.skin);
    r(11, 14, 3, 1, '#a15b52');
    r(7, 12, 2, 1, '#db927a');
    r(16, 12, 2, 1, '#db927a');
    r(10, 19, 2, 6, p.dark);
    r(12, 19, 1, 6, p.light);
  }
  if (role === 'captain') {
    r(5, 4, 15, 3, '#d6aa66');
    r(7, 1, 10, 3, outline);
    r(8, 1, 8, 3, '#d6aa66');
    r(8, 2, 8, 1, '#fae3a0');
    r(11, 3, 2, 2, '#75553c');
    r(6, 18, 3, 2, '#f9d98e');
    r(16, 18, 3, 2, '#f9d98e');
    if (direction === 'south') {
      r(14, 21, 2, 2, '#f8d981');
      r(11, 22, 1, 1, '#f8d981');
    }
  }
  if (role === 'scout') {
    r(6, 6, 12, 2, '#94c69d');
    r(17, 7, 3, 3, '#638e7b');
    r(7, 19, 2, 8, '#bc9161');
    r(8, 25, 8, 2, '#bc9161');
    if (direction === 'north') {
      r(8, 19, 8, 7, '#6e7150');
      r(9, 20, 6, 3, '#a5a074');
    }
  }
  if (role === 'mapper') {
    r(5, 3, 13, 3, p.hair);
    r(7, 2, 3, 2, p.hairLight);
    r(12, 2, 3, 2, p.hairLight);
    if (direction === 'south') {
      r(7, 8, 5, 4, '#cca65b');
      r(13, 8, 5, 4, '#cca65b');
      r(12, 9, 1, 1, '#cca65b');
      r(8, 9, 3, 2, '#637e87');
      r(14, 9, 3, 2, '#637e87');
      r(8, 9, 1, 1, '#dce3c7');
    }
    r(13, 21, 4, 4, '#d1c597');
    r(14, 22, 2, 1, '#786c5b');
  }
  if (role === 'analyst') {
    r(4, 7, 3, 9, p.hair);
    r(18, 6, 3, 10, p.hair);
    r(19, 8, 1, 6, p.hairLight);
    r(7, 5, 9, 2, p.hairLight);
    r(6, 7, 4, 1, p.hair);
    r(15, 18, 3, 6, '#e4d9bf');
    r(7, 18, 2, 7, '#e4d9bf');
    r(15, 22, 2, 1, '#8baeb0');
  }
  if (role === 'reviewer') {
    r(3, 6, 3, 8, p.hair);
    r(2, 8, 3, 6, p.hairLight);
    r(3, 14, 3, 3, p.hair);
    r(5, 5, 3, 3, '#e9b97b');
    r(9, 5, 5, 2, p.hairLight);
    r(7, 18, 10, 2, '#f0c392');
    r(14, 20, 3, 5, '#f0c392');
    if (action === 'work') {
      r(17, 19, 5, 6, '#b89e73');
      r(18, 20, 3, 4, '#f1deae');
    }
  }
  if (role === 'scribe') {
    r(9, 0, 6, 4, outline);
    r(10, 0, 4, 3, p.hair);
    r(11, 0, 2, 1, p.hairLight);
    r(7, 4, 10, 2, p.hairLight);
    r(8, 21, 8, 6, '#c8b990');
    r(9, 21, 6, 2, '#ece0b2');
    r(13, 24, 2, 2, p.dark);
  }
  cache.set(key, canvas);
  return canvas;
}
