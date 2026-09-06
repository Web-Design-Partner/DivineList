import { WORLD_HEIGHT, WORLD_WIDTH } from './crew';

type Ctx = CanvasRenderingContext2D;
const ink = '#202b35';
const brass = '#c4a271';
const rect = (
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
const noise = (x: number, y: number, seed = 0) =>
  ((x * 73 + y * 137 + seed * 17) ^ (x * y * 13)) >>> 0;

function poly(c: Ctx, points: number[][], color: string) {
  // Scanline rasterization keeps diagonals on the same sharp pixel grid as sprites.
  c.fillStyle = color;
  const first = Math.min(...points.map((point) => point[1]));
  const last = Math.max(...points.map((point) => point[1]));
  for (let y = first; y < last; y++) {
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if ((ay <= y && by > y) || (by <= y && ay > y))
        crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2)
      c.fillRect(
        Math.ceil(crossings[i]),
        y,
        Math.ceil(crossings[i + 1]) - Math.ceil(crossings[i]),
        1,
      );
  }
}

function planks(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  light = false,
) {
  const palette = light
    ? ['#a18b69', '#a58e6c', '#998264', '#ad9270']
    : ['#79694f', '#806e53', '#857259', '#786950'];
  rect(c, x, y, w, h, '#534d42');
  for (let row = 0; row < h / 8; row++) {
    for (let column = -1; column < w / 34; column++) {
      const sx = x + column * 34 + (row % 2 ? 17 : 0);
      const left = Math.max(x, sx);
      const right = Math.min(x + w, sx + 33);
      if (right <= left) continue;
      rect(
        c,
        left,
        y + row * 8,
        right - left,
        Math.min(7, h - row * 8),
        palette[noise(row, column) % 4],
      );
      if (right - left > 12) {
        rect(
          c,
          left + 3,
          y + row * 8 + 2,
          Math.min(14, right - left - 4),
          1,
          light ? '#b29b77' : '#917b5b',
        );
        rect(
          c,
          right - 8,
          y + row * 8 + 5,
          5,
          1,
          light ? '#947d5f' : '#6e604a',
        );
      }
    }
  }
}

function rug(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  rect(c, x, y, w, h, '#49453e');
  rect(c, x + 1, y, w - 2, h - 1, color);
  rect(c, x + 3, y + 2, w - 6, 1, '#c1ad85');
  rect(c, x + 3, y + h - 4, w - 6, 1, '#c1ad85');
  for (let n = 0; n < w - 6; n += 5) {
    rect(c, x + 3 + n, y + 4, 2, 1, '#b5a382');
    rect(c, x + 3 + n, y + h - 6, 2, 1, '#b5a382');
  }
  for (let n = 2; n < h; n += 3) {
    rect(c, x - 2, y + n, 2, 1, '#b5a382');
    rect(c, x + w, y + n, 2, 1, '#b5a382');
  }
}

function wall(c: Ctx, x: number, y: number, w: number, h = 12) {
  rect(c, x, y + 3, w + 3, h + 3, '#313936');
  rect(c, x, y, w, h, '#766e58');
  rect(c, x, y, w, 3, '#c7b58d');
  rect(c, x + 1, y + 3, w - 2, 5, '#a89a77');
  rect(c, x + 1, y + h - 2, w - 2, 2, '#4e544a');
  for (let n = 3; n < w - 2; n += 18) {
    rect(c, x + n, y + 3, 1, 5, '#887e64');
    rect(c, x + n + 2, y + 4, 2, 1, '#d9c89b');
  }
}

function plant(c: Ctx, x: number, y: number, tall = false) {
  rect(c, x - 6, y - 3, 13, 4, '#41443c');
  rect(c, x - 5, y - 11, 10, 8, '#915f4a');
  rect(c, x - 4, y - 10, 3, 6, '#bd8b61');
  rect(c, x - 6, y - 12, 12, 3, '#d0a27b');
  rect(c, x - 4, y - 13, 8, 2, '#4f483c');
  const height = tall ? 27 : 17;
  rect(c, x, y - height, 1, height - 12, '#a3ae72');
  for (let n = 0; n < (tall ? 4 : 3); n++) {
    const py = y - 14 - n * 4;
    poly(
      c,
      [
        [x, py],
        [x - 6 + n, py - 2],
        [x - 8 + n, py - 6],
        [x - 3, py - 5],
        [x, py - 2],
      ],
      n % 2 ? '#789761' : '#567859',
    );
    poly(
      c,
      [
        [x + 1, py - 1],
        [x + 7 - n, py - 2],
        [x + 8 - n, py - 6],
        [x + 3, py - 6],
      ],
      '#94aa72',
    );
    rect(c, x + 2, py - 4, 3, 1, '#bdc58a');
  }
}

function bookshelf(c: Ctx, x: number, y: number, width = 34) {
  rect(c, x + 2, y + 2, width, 34, '#484638');
  rect(c, x, y, width, 32, '#9b7954');
  rect(c, x + 2, y + 2, width - 4, 28, '#4e4b3e');
  const colors = ['#9bac81', '#719e9f', '#b87f67', '#b5a17e', '#8988a2'];
  for (let row = 0; row < 2; row++) {
    for (let n = 0; n < width - 7; n += 5) {
      const height = 7 + (noise(n, row) % 4);
      rect(
        c,
        x + 4 + n,
        y + 12 + row * 14 - height,
        4,
        height,
        colors[(n + row) % 5],
      );
      rect(c, x + 5 + n, y + 11 + row * 14, 2, 1, '#d5c9a4');
    }
    rect(c, x + 2, y + 13 + row * 14, width - 4, 3, '#b39568');
    rect(c, x + 2, y + 16 + row * 14, width - 4, 1, '#745b44');
  }
  rect(c, x, y, width, 2, '#c0a16f');
}

function desk(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  screen: string,
  kind = 'computer',
) {
  rect(c, x + 3, y + 15, w, 7, '#42413b');
  rect(c, x + 3, y + 13, 4, 8, '#655447');
  rect(c, x + w - 6, y + 13, 4, 8, '#655447');
  rect(c, x, y + 2, w, 14, '#5d4c3e');
  rect(c, x, y, w, 12, '#b99a6b');
  rect(c, x + 2, y + 2, w - 4, 8, '#cfb381');
  rect(c, x + 2, y + 10, w - 4, 2, '#92784f');
  rect(c, x + 5, y + 12, w - 10, 2, '#806245');
  rect(c, x + 10, y + 13, 6, 1, '#dec18b');
  if (kind === 'writing') {
    rect(c, x + 6, y - 2, 20, 10, '#716550');
    rect(c, x + 6, y - 4, 20, 10, '#e6d7ac');
    rect(c, x + 16, y - 4, 1, 10, '#a29477');
    for (let n = 0; n < 3; n++) {
      rect(c, x + 8, y - 2 + n * 2, 6, 1, '#a49b7d');
      rect(c, x + 18, y - 2 + n * 2, 5, 1, '#a49b7d');
    }
    rect(c, x + 30, y, 4, 5, '#405a65');
    rect(c, x + 31, y - 5, 1, 6, '#cfb27f');
  } else {
    rect(c, x + 9, y - 19, 34, 23, ink);
    rect(c, x + 10, y - 18, 32, 19, '#718e8c');
    rect(c, x + 12, y - 16, 28, 15, '#263f4a');
    rect(c, x + 13, y - 15, 26, 13, screen);
    rect(c, x + 14, y - 14, 3, 10, '#ffffff20');
    rect(c, x + 15, y - 12, 11, 1, '#e6efc9');
    rect(c, x + 15, y - 9, 6, 1, '#bdd9b7');
    rect(c, x + 15, y - 6, 13, 1, '#bdd9b7');
    rect(c, x + 30, y - 10, 6, 6, '#253e4840');
    rect(c, x + 33, y - 8, 2, 3, '#d9db9b');
    rect(c, x + 23, y + 1, 7, 3, '#627a77');
    rect(c, x + 17, y + 5, 23, 4, '#746e59');
    for (let n = 0; n < 10; n += 2)
      rect(c, x + 19 + n * 2, y + 6, 1, 1, '#d9ccab');
  }
  rect(c, x + w - 11, y + 1, 5, 5, '#7b6951');
  rect(c, x + w - 11, y, 4, 4, '#ece1c2');
  rect(c, x + w - 7, y + 1, 2, 2, '#dac6a0');
  rect(c, x + w - 10, y, 2, 1, '#6b5946');
}

function belt(c: Ctx, x: number, y: number, w: number, color: string) {
  rect(c, x + 1, y + 3, w, 14, '#373c39');
  rect(c, x, y, w, 15, '#486066');
  rect(c, x + 1, y + 1, w - 2, 2, '#93a69a');
  rect(c, x + 1, y + 12, w - 2, 2, '#b5aa82');
  rect(c, x + 3, y + 4, w - 6, 7, '#293f48');
  for (let n = 3; n < w - 5; n += 6) {
    rect(c, x + n, y + 4, 2, 7, '#6d7d73');
    rect(c, x + n + 1, y + 4, 1, 7, '#859184');
  }
  rect(c, x - 1, y + 5, 3, 6, '#b69b68');
  rect(c, x + w - 2, y + 5, 3, 6, '#b69b68');
  rect(c, x + w - 8, y + 1, 3, 2, color);
}

function crate(c: Ctx, x: number, y: number, size = 18) {
  rect(c, x + 2, y + 2, size, size, '#43483f');
  rect(c, x, y, size, size - 2, '#8c7050');
  rect(c, x + 2, y + 2, size - 4, size - 6, '#b69a68');
  rect(c, x + 3, y + 4, size - 6, 1, '#a2875d');
  rect(c, x + 3, y + 8, size - 6, 1, '#a2875d');
  rect(c, x + 7, y, 3, size - 2, '#dfc58e');
  rect(c, x + 3, y + size - 5, size - 6, 1, '#695943');
  rect(c, x + 2, y + 2, 1, 1, '#ead8a8');
  rect(c, x + size - 3, y + size - 4, 1, 1, '#4e493c');
}

function lamp(c: Ctx, x: number, y: number) {
  rect(c, x - 7, y - 1, 15, 13, '#d4b2770b');
  rect(c, x - 5, y, 11, 9, '#e8c5820c');
  rect(c, x - 3, y, 7, 4, '#62594a');
  rect(c, x - 2, y - 2, 5, 4, '#d9b673');
  rect(c, x - 1, y - 1, 3, 2, '#f7e5ab');
  rect(c, x, y + 4, 1, 2, '#d4b278');
}

export function createEnvironment() {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_WIDTH;
  canvas.height = WORLD_HEIGHT;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  rect(c, 0, 0, 720, 430, '#0c1727');
  // Pixel-cloud nebulae and a distant shaded moon. No remote texture or font dependency.
  for (let y = 0; y < 430; y += 6)
    for (let x = 0; x < 720; x += 6) {
      const cloud = Math.sin(x / 103 + y / 111) + Math.cos(y / 57 - x / 179);
      if (cloud > 1.0)
        rect(c, x, y, 6, 6, noise(x, y) % 3 ? '#112032' : '#142437');
      else if (cloud < -1.1 && noise(x, y) % 3) rect(c, x, y, 6, 6, '#131d30');
    }
  poly(
    c,
    [
      [577, 21],
      [609, 21],
      [609, 25],
      [621, 25],
      [621, 31],
      [629, 31],
      [629, 42],
      [633, 42],
      [633, 60],
      [629, 60],
      [629, 69],
      [621, 69],
      [621, 75],
      [583, 75],
      [583, 71],
      [571, 71],
      [571, 61],
      [567, 61],
      [567, 37],
      [571, 37],
      [571, 28],
      [577, 28],
    ],
    '#526476',
  );
  poly(
    c,
    [
      [600, 21],
      [609, 21],
      [609, 25],
      [621, 25],
      [621, 31],
      [629, 31],
      [629, 42],
      [633, 42],
      [633, 60],
      [629, 60],
      [629, 69],
      [621, 69],
      [621, 75],
      [600, 75],
      [609, 70],
      [616, 62],
      [619, 50],
      [615, 34],
    ],
    '#2f445c',
  );
  rect(c, 580, 34, 10, 3, '#6b7a87');
  rect(c, 576, 47, 8, 7, '#44596e');
  rect(c, 589, 58, 11, 5, '#41566b');
  rect(c, 583, 61, 9, 3, '#657681');
  rect(c, 601, 29, 7, 2, '#617082');
  // Dorsal antenna, brass fittings and rear engine assemblies.
  rect(c, 174, 71, 1, 16, brass);
  rect(c, 164, 70, 22, 2, '#648387');
  rect(c, 171, 62, 7, 2, '#8ba299');
  rect(c, 327, 74, 68, 7, '#4d696e');
  rect(c, 337, 68, 48, 6, '#718b83');
  rect(c, 344, 66, 33, 2, '#a9b198');
  rect(c, 345, 70, 2, 3, '#cfbf8f');
  for (const y of [135, 286]) {
    rect(c, 44, y + 2, 51, 34, '#243746');
    rect(c, 42, y, 47, 30, '#526d71');
    rect(c, 45, y + 3, 37, 24, '#294654');
    rect(c, 46, y + 5, 7, 20, '#7f9185');
    rect(c, 54, y + 4, 25, 2, '#83978e');
    rect(c, 54, y + 23, 25, 2, '#203747');
    for (let n = 0; n < 5; n++) {
      rect(c, 56 + n * 5, y + 7, 2, 14, '#658086');
      rect(c, 56 + n * 5, y + 8, 1, 12, '#90a89b');
    }
    rect(c, 38, y + 8, 8, 15, '#a1ab8d');
    rect(c, 38, y + 11, 4, 9, '#75d0c0');
  }
  const hull = [
    [78, 105],
    [108, 105],
    [108, 90],
    [149, 90],
    [149, 82],
    [535, 82],
    [535, 94],
    [579, 94],
    [579, 111],
    [609, 111],
    [609, 132],
    [634, 132],
    [634, 156],
    [655, 156],
    [655, 184],
    [673, 184],
    [673, 276],
    [655, 276],
    [655, 306],
    [634, 306],
    [634, 330],
    [609, 330],
    [609, 347],
    [566, 347],
    [566, 360],
    [130, 360],
    [130, 350],
    [96, 350],
    [96, 330],
    [78, 330],
  ];
  poly(
    c,
    hull.map(([x, y]) => [x + 4, y + 12]),
    '#06101c',
  );
  poly(c, hull, '#2d4752');
  poly(
    c,
    hull.map(([x, y]) => [x, y - 5]),
    '#9da38b',
  );
  poly(
    c,
    [
      [89, 112],
      [119, 112],
      [119, 97],
      [159, 97],
      [159, 89],
      [527, 89],
      [527, 103],
      [570, 103],
      [570, 119],
      [600, 119],
      [600, 140],
      [625, 140],
      [625, 165],
      [646, 165],
      [646, 192],
      [664, 192],
      [664, 265],
      [646, 265],
      [646, 296],
      [625, 296],
      [625, 320],
      [601, 320],
      [601, 337],
      [558, 337],
      [558, 349],
      [139, 349],
      [139, 339],
      [106, 339],
      [106, 320],
      [89, 320],
    ],
    '#3a5359',
  );
  // Hull plating, seams, rivets and maintenance markings.
  for (let x = 158; x < 527; x += 46) {
    rect(c, x, 79, 43, 8, '#879888');
    rect(c, x + 1, 79, 40, 1, '#c9c29e');
    rect(c, x + 2, 85, 39, 1, '#667d73');
    rect(c, x + 5, 81, 2, 2, '#d4cda8');
    rect(c, x + 34, 81, 2, 2, '#d4cda8');
    rect(c, x + 13, 83, 11, 1, '#99a28a');
  }
  for (let y = 113; y < 319; y += 35) {
    rect(c, 80, y, 7, 31, '#879888');
    rect(c, 80, y, 1, 29, '#d1c6a0');
    rect(c, 82, y + 3, 2, 2, '#cbbf95');
    rect(c, 82, y + 26, 2, 2, '#536b63');
  }
  for (const [x, y] of [
    [542, 96],
    [583, 114],
    [612, 136],
    [638, 162],
    [658, 190],
    [658, 252],
    [638, 295],
    [613, 319],
    [580, 337],
  ]) {
    rect(c, x, y, 10, 3, '#b9b18f');
    rect(c, x + 1, y + 1, 2, 1, '#e2d0a3');
    rect(c, x + 7, y + 1, 2, 1, '#60766b');
  }
  for (let x = 158; x < 536; x += 24) {
    rect(c, x, 86, 1, 11, '#61726a');
    rect(c, x + 4, 85, 2, 2, '#e2d0a3');
    rect(c, x, 343, 1, 10, '#61726a');
    rect(c, x + 4, 352, 2, 2, '#ddcc9f');
  }
  for (let y = 124; y < 320; y += 22) {
    rect(c, 80, y, 6, 2, '#637a78');
    rect(c, 82, y - 5, 2, 2, '#d5c597');
  }
  rect(c, 133, 340, 145, 3, '#c19c63');
  rect(c, 418, 340, 125, 3, '#c19c63');
  rect(c, 137, 345, 7, 2, '#e1c893');
  rect(c, 540, 346, 8, 2, '#e1c893');
  // Open cutaway: six work zones share one continuous deck.
  planks(c, 105, 112, 431, 224);
  planks(c, 537, 158, 82, 156, true);
  poly(
    c,
    [
      [619, 170],
      [638, 191],
      [654, 213],
      [654, 253],
      [638, 278],
      [619, 302],
    ],
    '#a58d69',
  );
  for (let y = 180; y < 303; y += 8)
    rect(c, 619, y, y < 200 || y > 276 ? 9 : 23, 1, '#766a54');
  wall(c, 107, 101, 428);
  // Windows: thick frames, night reflections, warm inner sill.
  for (const x of [132, 267, 405]) {
    rect(c, x, 95, 68, 13, '#273e48');
    rect(c, x + 3, 96, 62, 8, '#497b85');
    rect(c, x + 5, 97, 58, 6, '#75a2a0');
    rect(c, x + 9, 97, 2, 6, '#b2c6ac');
    rect(c, x + 32, 96, 3, 9, '#4a686b');
    rect(c, x + 1, 106, 66, 2, '#dfc698');
  }
  // Upper room partitions include wide corridor doorways.
  wall(c, 106, 203, 60, 8);
  wall(c, 196, 203, 43, 8);
  wall(c, 245, 203, 48, 8);
  wall(c, 323, 203, 55, 8);
  wall(c, 384, 203, 53, 8);
  wall(c, 467, 203, 69, 8);
  rect(c, 238, 112, 7, 99, '#5a6557');
  rect(c, 238, 112, 2, 91, '#c0ae85');
  rect(c, 377, 112, 7, 99, '#5a6557');
  rect(c, 377, 112, 2, 91, '#c0ae85');
  for (const x of [169, 297, 441]) {
    rect(c, x, 204, 23, 3, '#b8a478');
    rect(c, x + 1, 208, 21, 2, '#4e5246');
  }
  // Furnishings give each department a different purpose and silhouette.
  rug(c, 131, 163, 88, 33, '#647963');
  desk(c, 125, 142, 62, '#679f82');
  plant(c, 219, 150, true);
  rect(c, 195, 119, 25, 22, '#534d40');
  rect(c, 197, 121, 21, 18, '#d0bb89');
  poly(
    c,
    [
      [200, 124],
      [205, 126],
      [203, 131],
      [210, 133],
      [215, 129],
      [216, 137],
      [200, 137],
    ],
    '#8c9e76',
  );
  rect(c, 205, 129, 3, 2, '#ba7350');
  rect(c, 215, 124, 1, 6, '#86644a');
  belt(c, 126, 184, 50, '#8dc0a1');
  rug(c, 265, 163, 91, 33, '#587a82');
  desk(c, 260, 142, 61, '#6496a3');
  bookshelf(c, 336, 119, 29);
  rect(c, 335, 157, 28, 10, '#bdab82');
  rect(c, 337, 158, 24, 7, '#e4d8ac');
  for (let n = 0; n < 4; n++) rect(c, 340 + n * 5, 159, 1, 5, '#91a9a0');
  belt(c, 260, 184, 52, '#8bc5cd');
  rug(c, 405, 163, 109, 33, '#777086');
  desk(c, 398, 142, 64, '#9587b2');
  rect(c, 487, 119, 26, 38, '#3d535a');
  rect(c, 489, 121, 22, 32, '#617c7d');
  for (let n = 0; n < 4; n++) {
    rect(c, 492, 124 + n * 7, 16, 5, '#324b54');
    rect(c, 494, 125 + n * 7, 2, 1, '#b8d2aa');
    rect(c, 499, 125 + n * 7, 6, 1, '#7aa6a0');
  }
  plant(c, 474, 157);
  belt(c, 399, 184, 53, '#baa9d0');
  // The main cargo conveyor is split at the three walking crossings.
  belt(c, 113, 217, 53, '#c9bc8a');
  belt(c, 197, 217, 97, '#c9bc8a');
  belt(c, 324, 217, 113, '#c9bc8a');
  belt(c, 468, 217, 62, '#c9bc8a');
  for (const x of [168, 295, 439])
    for (let n = 0; n < 4; n++) rect(c, x + n * 6, 225, 3, 2, '#c7b889');
  rug(c, 127, 238, 386, 10, '#626b5c');
  // Lower rooms: inspection, writing and a small greenhouse / cargo hold.
  wall(c, 106, 255, 65, 8);
  wall(c, 199, 255, 74, 8);
  wall(c, 280, 255, 29, 8);
  wall(c, 337, 255, 87, 8);
  wall(c, 431, 255, 31, 8);
  wall(c, 490, 255, 46, 8);
  rect(c, 273, 263, 7, 73, '#596351');
  rect(c, 273, 263, 2, 71, '#b9a97e');
  rect(c, 424, 263, 7, 73, '#596351');
  rect(c, 424, 263, 2, 71, '#b9a97e');
  rug(c, 135, 299, 116, 27, '#9a7360');
  desk(c, 131, 281, 67, '#b18b71');
  bookshelf(c, 223, 267, 33);
  belt(c, 132, 313, 50, '#e0ac88');
  rect(c, 109, 273, 13, 31, '#46585a');
  rect(c, 111, 275, 9, 27, '#8b9e90');
  for (let n = 0; n < 3; n++) {
    rect(c, 113, 278 + n * 8, 5, 4, '#d6cfab');
    rect(c, 114, 279 + n * 8, 3, 1, '#787d6c');
  }
  rug(c, 299, 299, 108, 27, '#80845e');
  desk(c, 297, 280, 58, '#829e8a', 'writing');
  bookshelf(c, 371, 266, 39);
  plant(c, 363, 289);
  belt(c, 297, 313, 55, '#c6cd95');
  rect(c, 446, 267, 69, 16, '#6e7959');
  rect(c, 448, 269, 65, 10, '#3e5145');
  for (const x of [455, 474, 494, 508]) plant(c, x, 284, x % 2 === 0);
  crate(c, 445, 303, 18);
  crate(c, 467, 307, 20);
  crate(c, 450, 293, 17);
  rect(c, 501, 304, 18, 21, '#48615b');
  rect(c, 502, 303, 16, 3, '#a5b298');
  rect(c, 503, 308, 14, 13, '#639796');
  rect(c, 505, 311, 2, 8, '#94c1ad');
  // Bridge: wrap-around windows, copper rails, navigation rug, command console.
  rect(c, 534, 112, 7, 105, '#647365');
  rect(c, 534, 248, 7, 87, '#647365');
  rect(c, 534, 112, 2, 105, '#c4b388');
  rect(c, 534, 248, 2, 87, '#c4b388');
  poly(
    c,
    [
      [551, 129],
      [579, 129],
      [579, 145],
      [602, 145],
      [602, 167],
      [624, 167],
      [624, 190],
      [645, 190],
      [645, 266],
      [625, 266],
      [625, 291],
      [603, 291],
      [603, 313],
      [573, 313],
      [573, 321],
      [551, 321],
      [551, 311],
      [570, 311],
      [570, 302],
      [594, 302],
      [594, 280],
      [615, 280],
      [615, 255],
      [635, 255],
      [635, 201],
      [615, 201],
      [615, 176],
      [593, 176],
      [593, 155],
      [570, 155],
      [570, 140],
      [551, 140],
    ],
    '#78a8a5',
  );
  for (let n = 0; n < 5; n++)
    rect(c, 555 + n * 7, 130 + n * 7, 2, 7, '#c4d7b5');
  rect(c, 637, 206, 5, 17, '#a3c9b8');
  rect(c, 637, 230, 5, 18, '#5a8e92');
  rug(c, 552, 231, 70, 67, '#637e7a');
  rect(c, 561, 237, 52, 1, '#a5b092');
  rect(c, 561, 289, 52, 1, '#a5b092');
  for (let n = 0; n < 4; n++) {
    rect(c, 578 + n * 5, 256 + n * 3, 3, 1, '#b7be94');
    rect(c, 578 + n * 5, 276 - n * 3, 3, 1, '#b7be94');
  }
  desk(c, 581, 206, 48, '#739da0');
  rect(c, 552, 166, 21, 24, '#715e49');
  rect(c, 553, 164, 19, 21, '#bc9863');
  rect(c, 556, 168, 13, 12, '#425d60');
  rect(c, 559, 171, 6, 6, '#9caf92');
  rect(c, 561, 169, 2, 10, '#d5c68b');
  rect(c, 557, 173, 10, 2, '#d5c68b');
  plant(c, 559, 304, true);
  plant(c, 548, 150);
  for (const [x, y] of [
    [113, 117],
    [230, 117],
    [251, 117],
    [370, 117],
    [389, 117],
    [525, 117],
    [114, 269],
    [267, 269],
    [285, 269],
    [417, 269],
    [547, 225],
  ])
    lamp(c, x, y);
  // Exterior typography is quiet, readable and secondary to the pixel scene.
  c.font = '6px monospace';
  c.fillStyle = '#c5b891';
  c.textAlign = 'center';
  c.fillText('D I V I N E   /   0 1', 346, 354);
  c.font = '5px monospace';
  c.fillStyle = '#ccbd97';
  for (const [label, x, y] of [
    ['OBSERVATORIET', 166, 119],
    ['KARTRUMMET', 301, 119],
    ['LABORATORIET', 437, 119],
    ['GRANSKNING', 177, 270],
    ['ARKIVET', 334, 270],
  ] as const)
    c.fillText(label, x, y);
  return canvas;
}

/** Tiny environmental effects are ambient; belts move only for actual running jobs. */
export function drawAmbient(c: Ctx, time: number, animate: boolean) {
  const tick = animate ? Math.floor(time / 150) : 0;
  for (let n = 0; n < 91; n++) {
    const x = (n * 149 + 17) % 720;
    const y = (n * 83 + 29) % 430;
    if (x > 40 && x < 681 && y > 66 && y < 369) continue;
    const bright = (Math.floor(time / 1000) + n) % 7 === 0;
    rect(
      c,
      x,
      y,
      1,
      1,
      bright && animate ? '#adcec8' : n % 3 ? '#3e5b74' : '#6c8c9b',
    );
    if (n % 13 === 0) {
      rect(c, x - 1, y, 3, 1, '#6f929f');
      rect(c, x, y - 1, 1, 3, '#6f929f');
    }
  }
  for (const y of [146, 297]) {
    const length = [15, 18, 16, 21][tick % 4];
    poly(
      c,
      [
        [38, y - 2],
        [27, y - 2],
        [27, y],
        [38 - length, y],
        [38 - length, y + 4],
        [24, y + 4],
        [24, y + 7],
        [38, y + 7],
      ],
      '#32677b',
    );
    poly(
      c,
      [
        [38, y],
        [30, y],
        [30, y + 2],
        [24 + (tick % 3), y + 2],
        [24 + (tick % 3), y + 4],
        [38, y + 5],
      ],
      '#64b5ae',
    );
    rect(c, 32 + (tick % 2), y + 1, 6, 3, '#c4e1b7');
  }
  // Aquarium bubbles and navigation beacons; neither represents research output.
  rect(c, 512, 316 - (tick % 5), 1, 1, '#b8dbb9');
  rect(c, 174, 62, 1, 1, tick % 8 < 5 ? '#dfb773' : '#a37e59');
  rect(c, 659, 229, 2, 3, tick % 8 < 5 ? '#86c4ac' : '#5d9588');
}

export function drawBeltMotion(c: Ctx, time: number, role: string) {
  const belts: Record<string, [number, number, number]> = {
    scout: [126, 184, 50],
    mapper: [260, 184, 52],
    analyst: [399, 184, 53],
    reviewer: [132, 313, 50],
    scribe: [297, 313, 55],
  };
  const belt = belts[role];
  if (!belt) return;
  const [x, y, width] = belt;
  rect(c, x + 3, y + 4, width - 6, 7, '#293f48');
  const phase = Math.floor(time / 110) % 6;
  for (let n = 3; n < width - 5; n++)
    if ((n + phase) % 6 < 2) rect(c, x + n, y + 4, 1, 7, '#879387');
  // One document denotes the single active task, never a fabricated company count.
  rect(c, x + 18, y + 2, 9, 9, '#524b3d');
  rect(c, x + 18, y + 1, 8, 8, '#e5d8ad');
  rect(c, x + 20, y + 3, 4, 1, '#9eaa92');
  rect(c, x + 20, y + 5, 3, 1, '#9eaa92');
}
