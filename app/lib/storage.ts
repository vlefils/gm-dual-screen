import {
  collectAssetIds,
  createId,
  type AssetRecord,
  type Scene,
} from "./model.ts";

const DATABASE_NAME = "ecran-du-mj";
const DATABASE_VERSION = 1;
const SCENES_STORE = "scenes";
const ASSETS_STORE = "assets";
const SETTINGS_STORE = "settings";

type SettingRecord = {
  key: string;
  value: string;
};

type BackupAsset = Omit<AssetRecord, "blob"> & {
  data: string;
};

export type BackupManifest = {
  format: "ecran-du-mj";
  version: 1;
  exportedAt: string;
  scenes: Scene[];
  assets: BackupAsset[];
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SCENES_STORE)) {
        database.createObjectStore(SCENES_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ASSETS_STORE)) {
        database.createObjectStore(ASSETS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getScenes(): Promise<Scene[]> {
  const database = await openDatabase();
  const transaction = database.transaction(SCENES_STORE, "readonly");
  const scenes = await requestResult(
    transaction.objectStore(SCENES_STORE).getAll() as IDBRequest<Scene[]>,
  );
  database.close();
  return scenes
    .map((scene) => ({
      ...scene,
      scenarioMarkdown:
        typeof scene.scenarioMarkdown === "string" ? scene.scenarioMarkdown : "",
      imageViewports:
        scene.imageViewports && typeof scene.imageViewports === "object"
          ? scene.imageViewports
          : {},
      outsideRevealed: Boolean(scene.outsideRevealed),
    }))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export async function putScene(scene: Scene): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SCENES_STORE, "readwrite");
  transaction.objectStore(SCENES_STORE).put(scene);
  await transactionDone(transaction);
  database.close();
}

export async function removeScene(sceneId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SCENES_STORE, "readwrite");
  transaction.objectStore(SCENES_STORE).delete(sceneId);
  await transactionDone(transaction);
  database.close();
}

export async function putAsset(asset: AssetRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(ASSETS_STORE, "readwrite");
  transaction.objectStore(ASSETS_STORE).put(asset);
  await transactionDone(transaction);
  database.close();
}

export async function getAsset(assetId: string): Promise<AssetRecord | null> {
  const database = await openDatabase();
  const transaction = database.transaction(ASSETS_STORE, "readonly");
  const asset = await requestResult(
    transaction.objectStore(ASSETS_STORE).get(assetId) as IDBRequest<
      AssetRecord | undefined
    >,
  );
  database.close();
  return asset ?? null;
}

export async function getSetting(key: string): Promise<string | null> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS_STORE, "readonly");
  const setting = await requestResult(
    transaction.objectStore(SETTINGS_STORE).get(key) as IDBRequest<
      SettingRecord | undefined
    >,
  );
  database.close();
  return setting?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS_STORE, "readwrite");
  transaction.objectStore(SETTINGS_STORE).put({ key, value });
  await transactionDone(transaction);
  database.close();
}

export async function validateImage(
  file: File,
): Promise<{ width: number; height: number }> {
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(file.type)) {
    throw new Error("Format non pris en charge. Utilisez PNG, JPEG ou WebP.");
  }
  if (file.size > 30 * 1024 * 1024) {
    throw new Error("Cette image dépasse la limite de 30 Mo.");
  }

  const source = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        const image = new Image();
        image.onload = () =>
          resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        image.onerror = () => reject(new Error("L’image ne peut pas être lue."));
        image.src = source;
      },
    );
    if (!dimensions.width || !dimensions.height) {
      throw new Error("Les dimensions de l’image sont invalides.");
    }
    return dimensions;
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function saveImageFile(file: File): Promise<AssetRecord> {
  const dimensions = await validateImage(file);
  const asset: AssetRecord = {
    id: createId("asset"),
    name: file.name,
    type: file.type,
    blob: file,
    width: dimensions.width,
    height: dimensions.height,
    createdAt: new Date().toISOString(),
  };
  await putAsset(asset);
  return asset;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(data: string): Blob {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(data);
  if (!match) throw new Error("Une image de la sauvegarde est invalide.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}

export function parseBackupManifest(text: string): BackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n’est pas une sauvegarde valide.");
  }

  const manifest = value as Partial<BackupManifest>;
  if (
    manifest.format !== "ecran-du-mj" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.scenes) ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error("Version de sauvegarde non reconnue.");
  }
  return manifest as BackupManifest;
}

export async function createBackup(scenes: Scene[]): Promise<Blob> {
  const assetIds = collectAssetIds(scenes);
  const assets = (
    await Promise.all(assetIds.map((assetId) => getAsset(assetId)))
  ).filter((asset): asset is AssetRecord => Boolean(asset));
  const encodedAssets: BackupAsset[] = [];
  for (const asset of assets) {
    encodedAssets.push({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      data: await blobToDataUrl(asset.blob),
    });
  }
  const manifest: BackupManifest = {
    format: "ecran-du-mj",
    version: 1,
    exportedAt: new Date().toISOString(),
    scenes,
    assets: encodedAssets,
  };
  return new Blob([JSON.stringify(manifest)], {
    type: "application/x-ecran-du-mj+json",
  });
}

export async function importBackup(
  file: File,
  existingScenes: Scene[],
): Promise<Scene[]> {
  const manifest = parseBackupManifest(await file.text());
  const assetIdMap = new Map<string, string>();

  for (const asset of manifest.assets) {
    if (
      !asset ||
      typeof asset.id !== "string" ||
      typeof asset.data !== "string" ||
      typeof asset.name !== "string"
    ) {
      throw new Error("Une image de la sauvegarde est incomplète.");
    }
    const newId = createId("asset");
    assetIdMap.set(asset.id, newId);
    await putAsset({
      id: newId,
      name: asset.name,
      type: asset.type,
      width: Number(asset.width) || 1,
      height: Number(asset.height) || 1,
      createdAt: new Date().toISOString(),
      blob: dataUrlToBlob(asset.data),
    });
  }

  const usedNames = new Set(existingScenes.map((scene) => scene.name));
  const importedScenes: Scene[] = [];
  for (const original of manifest.scenes) {
    if (!original || typeof original.name !== "string") {
      throw new Error("Une scène de la sauvegarde est invalide.");
    }
    let name = original.name;
    if (usedNames.has(name)) name = `${name} (importée)`;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${original.name} (importée ${suffix})`;
      suffix += 1;
    }
    usedNames.add(name);

    const imageViewports: Scene["imageViewports"] = {};
    for (const [oldAssetId, viewport] of Object.entries(
      original.imageViewports ?? {},
    )) {
      const newAssetId = assetIdMap.get(oldAssetId);
      if (newAssetId) imageViewports[newAssetId] = viewport;
    }

    const scene: Scene = {
      ...structuredClone(original),
      id: createId("scene"),
      name,
      scenarioMarkdown:
        typeof original.scenarioMarkdown === "string"
          ? original.scenarioMarkdown
          : "",
      mapAssetId: original.mapAssetId
        ? (assetIdMap.get(original.mapAssetId) ?? null)
        : null,
      galleryAssetIds: original.galleryAssetIds
        .map((id) => assetIdMap.get(id))
        .filter((id): id is string => Boolean(id)),
      activeImageId: original.activeImageId
        ? (assetIdMap.get(original.activeImageId) ?? null)
        : null,
      imageViewports,
      outsideRevealed: Boolean(original.outsideRevealed),
      updatedAt: new Date().toISOString(),
    };
    await putScene(scene);
    importedScenes.push(scene);
  }
  return importedScenes;
}
