import * as Crypto from 'expo-crypto';

/**
 * Hermes lacks WebCrypto. Supabase PKCE needs SHA-256; without it auth-js
 * falls back to `plain` and GoTrue often rejects the exchange.
 *
 * Must run before any signInWithOAuth call. auth-js checks bare `crypto.subtle`.
 */
type MutableCrypto = {
  getRandomValues?: (array: ArrayBufferView) => ArrayBufferView;
  subtle?: { digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer> };
};

function ensureCrypto(): MutableCrypto {
  const g = globalThis as typeof globalThis & { crypto?: MutableCrypto; global?: { crypto?: MutableCrypto } };
  if (!g.crypto || typeof g.crypto !== 'object') {
    (g as { crypto: MutableCrypto }).crypto = {};
  }
  if (g.global && g.global !== g) {
    g.global.crypto = g.crypto;
  }
  return g.crypto as MutableCrypto;
}

function toArrayBuffer(data: BufferSource): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data.slice(0);
  }
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function digestAlgorithm(algorithm: AlgorithmIdentifier): Crypto.CryptoDigestAlgorithm {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
  switch (name.toUpperCase()) {
    case 'SHA-256':
      return Crypto.CryptoDigestAlgorithm.SHA256;
    case 'SHA-384':
      return Crypto.CryptoDigestAlgorithm.SHA384;
    case 'SHA-512':
      return Crypto.CryptoDigestAlgorithm.SHA512;
    default:
      throw new Error(`Unsupported digest algorithm: ${name}`);
  }
}

const cryptoRef = ensureCrypto();

if (typeof cryptoRef.getRandomValues !== 'function') {
  cryptoRef.getRandomValues = (array: ArrayBufferView): ArrayBufferView => {
    Crypto.getRandomValues(array as unknown as Parameters<typeof Crypto.getRandomValues>[0]);
    return array;
  };
}

if (!cryptoRef.subtle || typeof cryptoRef.subtle.digest !== 'function') {
  cryptoRef.subtle = {
    digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const bytes = new Uint8Array(toArrayBuffer(data));
      return Crypto.digest(digestAlgorithm(algorithm), bytes);
    },
  };
}
