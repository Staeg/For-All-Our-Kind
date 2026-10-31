// Seeded PRNG (mulberry32). Every random roll in the sim goes through one of these
// so a game is fully reproducible from its seed.
export class Rng {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(arr) {
    return arr[this.int(arr.length)];
  }

  range(lo, hi) {
    return lo + (hi - lo) * this.next();
  }
}
