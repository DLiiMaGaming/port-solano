// Seedable randomness: one small deterministic generator (mulberry32) plus the handful of
// helpers the city builder and the game logic share. A city built from a seed must come out
// identical on every machine, so the city builder draws only from generators made here and
// never from Math.random.

/**
 * Create a generator from a 32-bit seed. The returned object is the whole API:
 *   next()            float in [0, 1)
 *   range(a, b)       float in [a, b)
 *   int(a, b)         integer in [a, b] inclusive
 *   chance(p)         true with probability p
 *   pick(array)       one element (undefined for an empty array)
 *   shuffle(array)    in-place Fisher-Yates, returns the array
 *   pickWeighted(es)  entries are [value, weight] pairs; a zero weight never wins, an
 *                     all-zero list falls back to a uniform pick, empty gives undefined
 *   sign()            -1 or 1
 */
export function createRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(a, b) {
    return a + next() * (b - a);
  }

  function int(a, b) {
    return a + Math.floor(next() * (b - a + 1));
  }

  function chance(p) {
    return next() < p;
  }

  function pick(array) {
    if (!array || array.length === 0) return undefined;
    return array[Math.floor(next() * array.length)];
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  function pickWeighted(entries) {
    if (!entries || entries.length === 0) return undefined;
    let total = 0;
    for (let i = 0; i < entries.length; i += 1) total += Math.max(0, entries[i][1]);
    if (total <= 0) return pick(entries)[0];
    let roll = next() * total;
    for (let i = 0; i < entries.length; i += 1) {
      roll -= Math.max(0, entries[i][1]);
      if (roll <= 0) return entries[i][0];
    }
    return entries[entries.length - 1][0];
  }

  function sign() {
    return next() < 0.5 ? -1 : 1;
  }

  return { next, range, int, chance, pick, shuffle, pickWeighted, sign };
}

/** A stable 32-bit hash of two integers (tile coords, building ids): decoration without a stream. */
export function hash2(a, b) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
