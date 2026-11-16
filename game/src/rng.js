// A small seeded RNG (mulberry32) for screenshot staging and map variation. Gameplay
// randomness uses Math.random; staging uses this so a shot renders the same every time.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rand, min, max) {
  return min + rand() * (max - min);
}

export function int(rand, min, max) {
  return Math.floor(range(rand, min, max + 1));
}

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}
