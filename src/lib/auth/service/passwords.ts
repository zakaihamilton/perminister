import "server-only";

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { verify as verifyArgon2id } from "@node-rs/argon2";
import { compare as bcryptCompare } from "bcryptjs";
import type { PasswordCredential } from "../domain";
import { validatePassword } from "./validators";

const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const LEGACY_BCRYPT_CREDENTIAL_FORMAT = ["legacy", "bcrypt", "v1"].join("-");

export function hashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function equalHex(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(actual)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

function legacySaltedScrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      },
    );
  });
}

export async function createPasswordCredential(
  password: string,
  minimumLength = 15,
): Promise<PasswordCredential> {
  validatePassword(password, minimumLength);
  return createScryptPasswordCredential(password);
}

export async function createScryptPasswordCredential(
  password: string,
): Promise<PasswordCredential> {
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt);
  return {
    algorithm: "scrypt",
    format: "perminister-scrypt-v1",
    encodedVerifier: `scrypt$v=1$N=32768$r=8$p=1$${salt.toString("base64url")}$${digest.toString("base64url")}`,
    updatedAt: new Date().toISOString(),
  };
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential | null,
): Promise<boolean> {
  if (!credential) {
    await scrypt(password, Buffer.alloc(16, 4));
    return false;
  }
  if (credential.algorithm === "bcrypt") {
    if (
      credential.format !== LEGACY_BCRYPT_CREDENTIAL_FORMAT ||
      !/^\$2[aby]\$(?:0[4-9]|1[0-6])\$[./A-Za-z0-9]{53}$/.test(credential.encodedVerifier)
    ) {
      await scrypt(password, Buffer.alloc(16, 4));
      return false;
    }
    try {
      return await bcryptCompare(password, credential.encodedVerifier);
    } catch {
      return false;
    }
  }
  if (credential.algorithm === "argon2id") {
    if (!/^\$argon2id\$v=\d+\$/.test(credential.encodedVerifier)) {
      await scrypt(password, Buffer.alloc(16, 4));
      return false;
    }
    try {
      return await verifyArgon2id(credential.encodedVerifier, password);
    } catch {
      return false;
    }
  }
  if (/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(credential.encodedVerifier)) {
    const match = /^([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(credential.encodedVerifier);
    if (!match) {
      await scrypt(password, Buffer.alloc(16, 4));
      return false;
    }
    try {
      const expected = Buffer.from(match[2], "hex");
      const actual = await legacySaltedScrypt(password, match[1]);
      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
  const parts = credential.encodedVerifier.split("$");
  if (
    parts.length !== 7 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "v=1" ||
    parts[2] !== "N=32768" ||
    parts[3] !== "r=8" ||
    parts[4] !== "p=1"
  ) {
    await scrypt(password, Buffer.alloc(16, 4));
    return false;
  }
  try {
    const salt = Buffer.from(parts[5], "base64url");
    const expected = Buffer.from(parts[6], "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(password, salt);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function needsPasswordRehash(credential: PasswordCredential | null): boolean {
  return (
    !!credential &&
    (credential.algorithm !== "scrypt" ||
      (credential.format !== "perminister-scrypt-v1" &&
        !credential.encodedVerifier.startsWith("scrypt$v=1$N=32768$r=8$p=1$")))
  );
}
