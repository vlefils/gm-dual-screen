import assert from "node:assert/strict";
import test from "node:test";
import {
  getSupportedImageType,
  parseBackupManifest,
} from "../app/lib/storage.ts";

test("les types d’image usuels sont normalisés", () => {
  assert.equal(
    getSupportedImageType({ name: "portrait.JPG", type: "image/jpg" }),
    "image/jpeg",
  );
  assert.equal(
    getSupportedImageType({ name: "carte.png", type: "image/png" }),
    "image/png",
  );
});

test("l’extension prend le relais quand le navigateur omet le type", () => {
  assert.equal(
    getSupportedImageType({ name: "carte.JPEG", type: "" }),
    "image/jpeg",
  );
  assert.equal(
    getSupportedImageType({
      name: "illustration.webp",
      type: "application/octet-stream",
    }),
    "image/webp",
  );
  assert.equal(
    getSupportedImageType({ name: "illustration.gif", type: "" }),
    null,
  );
});

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
