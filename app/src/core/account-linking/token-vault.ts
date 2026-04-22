import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";

interface TokenVaultRow {
  id: string;
  iv: string;
  cipher_text: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
}

export class TokenVault {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;

  constructor(dbPath: string, secretSeed: string | undefined, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_vault_entries (
        id TEXT PRIMARY KEY,
        iv TEXT NOT NULL,
        cipher_text TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.key = createHash("sha256").update(secretSeed?.trim() || `atlas-local-vault:${dbPath}`).digest();
  }

  storeSecret(payload: unknown): string {
    const id = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plainText = Buffer.from(JSON.stringify(payload), "utf8");
    const cipherText = Buffer.concat([cipher.update(plainText), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO token_vault_entries (id, iv, cipher_text, auth_tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      iv.toString("base64url"),
      cipherText.toString("base64url"),
      authTag.toString("base64url"),
      now,
      now,
    );
    return id;
  }

  readSecret<T>(id: string): T | undefined {
    const row = this.db.prepare(`SELECT * FROM token_vault_entries WHERE id = ? LIMIT 1`).get(id) as TokenVaultRow | undefined;
    if (!row) {
      return undefined;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(row.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(row.auth_tag, "base64url"));
    const plainText = Buffer.concat([
      decipher.update(Buffer.from(row.cipher_text, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plainText) as T;
  }

  deleteSecret(id: string): void {
    this.db.prepare(`DELETE FROM token_vault_entries WHERE id = ?`).run(id);
  }
}
