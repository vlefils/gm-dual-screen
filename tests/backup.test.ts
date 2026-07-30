import assert from "node:assert/strict";
import test from "node:test";
import { parseBackupManifest } from "../app/lib/storage.ts";

test("une sauvegarde v1 valide est reconnue", () => {
  const manifest = parseBackupManifest(
    JSON.stringify({
      format: "ecran-du-mj",
      version: 1,
      exportedAt: "2026-07-30T00:00:00.000Z",
      scenes: [],
      assets: [],
    }),
  );
  assert.equal(manifest.version, 1);
});

test("une sauvegarde corrompue est refusée", () => {
  assert.throws(() => parseBackupManifest("{oops"));
  assert.throws(() =>
    parseBackupManifest(
      JSON.stringify({
        format: "autre-outil",
        version: 1,
        scenes: [],
        assets: [],
      }),
    ),
  );
});
