// PORT SOLANO — random.js
// A small seeded generator (mulberry32). The city is built from one fixed
// seed so Port Solano is the same city on every visit, and the screenshot
// scenes stay reproducible.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) { this.next = mulberry32(seed); }
  float() { return this.next(); }
  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }

  // In-place Fisher–Yates shuffle driven by this stream: one int(0, i)
  // draw per slot, from the last slot down to the second. That is the
  // exact draw pattern the city generator's prop scatter used to spell
  // out inline, so swapping the inline loop for this helper leaves the
  // generated city byte-identical. Returns the same array, shuffled.
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // Weighted pick from [value, weight] pairs: a value's chance of being
  // drawn is its share of the total weight. Entries with a non-positive
  // weight never win; if every weight is non-positive the pick falls
  // back to a uniform draw over the values, and an empty list yields
  // undefined. Consumes exactly one draw on the weighted path.
  pickWeighted(entries) {
    let total = 0;
    for (const [, w] of entries) if (w > 0) total += w;
    if (total <= 0) return entries.length ? this.pick(entries)[0] : undefined;
    let roll = this.next() * total;
    for (const [value, w] of entries) {
      if (w <= 0) continue;
      roll -= w;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][0];
  }
}
