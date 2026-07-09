// Minimal X25519 helpers shared by browser and server code.
// Uses the Montgomery ladder from RFC 7748 with BigInt. Not constant-time in JS,
// but keeps Primordia dependency-light while using Curve25519 for key agreement.

const P = (BigInt(1) << BigInt(255)) - BigInt(19);
const A24 = BigInt(121665);
const BASE_U = BigInt(9);

function mod(n: bigint): bigint {
  const r = n % P;
  return r >= BigInt(0) ? r : r + P;
}

function inv(n: bigint): bigint {
  let a = mod(n);
  let e = P - BigInt(2);
  let out = BigInt(1);
  while (e > BigInt(0)) {
    if (e & BigInt(1)) out = mod(out * a);
    a = mod(a * a);
    e >>= BigInt(1);
  }
  return out;
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let out = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) out = (out << BigInt(8)) + BigInt(bytes[i]);
  return out;
}

function bigIntToBytesLE(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

export function clampX25519PrivateKey(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 32) throw new Error('X25519 private key must be 32 bytes.');
  const out = new Uint8Array(bytes);
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

export function x25519(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const k = bytesToBigIntLE(clampX25519PrivateKey(privateKey));
  const u = bytesToBigIntLE(publicKey);
  let x1 = u;
  let x2 = BigInt(1);
  let z2 = BigInt(0);
  let x3 = u;
  let z3 = BigInt(1);
  let swap = BigInt(0);

  for (let t = 254; t >= 0; t--) {
    const kt = (k >> BigInt(t)) & BigInt(1);
    swap ^= kt;
    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = kt;

    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    x3 = mod((da + cb) ** BigInt(2));
    z3 = mod(x1 * mod((da - cb) ** BigInt(2)));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }

  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }
  return bigIntToBytesLE(mod(x2 * inv(z2)));
}

export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  const base = new Uint8Array(32);
  base[0] = Number(BASE_U);
  return x25519(privateKey, base);
}
