export const PANEL_WIDTH_MIN = 20;
export const PANEL_WIDTH_MAX = 50;
export const DEFAULT_PANEL_WIDTH = 25;

export type Point = {
  x: number;
  y: number;
};

export type ZoneKind = "rect" | "polygon";

export type RevealZone = {
  id: string;
  name: string;
  kind: ZoneKind;
  points: Point[];
  revealed: boolean;
};

export type RevealStroke = {
  id: string;
  points: Point[];
  radius: number;
};

export type MapViewport = {
  zoom: number;
  x: number;
  y: number;
};

export type Scene = {
  id: string;
  name: string;
  mapAssetId: string | null;
  galleryAssetIds: string[];
  activeImageId: string | null;
  panelVisible: boolean;
  panelWidth: number;
  zones: RevealZone[];
  strokes: RevealStroke[];
  viewport: MapViewport;
  updatedAt: string;
};

export type AssetRecord = {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: string;
};

export type FogSnapshot = {
  zones: RevealZone[];
  strokes: RevealStroke[];
};

export type SnapResult = {
  point: Point;
  snapped: boolean;
  zoneId: string | null;
};

export function createId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function createScene(index = 1): Scene {
  return {
    id: createId("scene"),
    name: `Scène ${index}`,
    mapAssetId: null,
    galleryAssetIds: [],
    activeImageId: null,
    panelVisible: true,
    panelWidth: DEFAULT_PANEL_WIDTH,
    zones: [],
    strokes: [],
    viewport: { zoom: 1, x: 0, y: 0 },
    updatedAt: new Date().toISOString(),
  };
}

export function cloneScene(scene: Scene, name: string): Scene {
  return {
    ...structuredClone(scene),
    id: createId("scene"),
    name,
    updatedAt: new Date().toISOString(),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampPanelWidth(value: number): number {
  return clamp(Math.round(value), PANEL_WIDTH_MIN, PANEL_WIDTH_MAX);
}

export function normalizePoint(point: Point): Point {
  return {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1),
  };
}

export function isUsableRect(points: Point[]): boolean {
  if (points.length < 2) return false;
  return (
    Math.abs(points[1].x - points[0].x) >= 0.01 &&
    Math.abs(points[1].y - points[0].y) >= 0.01
  );
}

export function movePolygonVertex(
  zone: RevealZone,
  vertexIndex: number,
  point: Point,
): RevealZone {
  if (
    zone.kind !== "polygon" ||
    vertexIndex < 0 ||
    vertexIndex >= zone.points.length
  ) {
    return zone;
  }
  return {
    ...zone,
    points: zone.points.map((current, index) =>
      index === vertexIndex ? normalizePoint(point) : current,
    ),
  };
}

function zoneBoundaryPoints(zone: RevealZone): Point[] {
  if (zone.kind === "polygon") return zone.points;
  if (zone.points.length < 2) return zone.points;
  const start = zone.points[0];
  const end = zone.points[1];
  return [
    start,
    { x: end.x, y: start.y },
    end,
    { x: start.x, y: end.y },
  ];
}

function closestPointOnSegment(
  point: Point,
  start: Point,
  end: Point,
  scaleX: number,
  scaleY: number,
): { point: Point; distance: number } {
  const segmentX = (end.x - start.x) * scaleX;
  const segmentY = (end.y - start.y) * scaleY;
  const pointX = (point.x - start.x) * scaleX;
  const pointY = (point.y - start.y) * scaleY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const progress =
    lengthSquared === 0
      ? 0
      : clamp(
          (pointX * segmentX + pointY * segmentY) / lengthSquared,
          0,
          1,
        );
  const candidate = {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
  return {
    point: candidate,
    distance: Math.hypot(
      (candidate.x - point.x) * scaleX,
      (candidate.y - point.y) * scaleY,
    ),
  };
}

export function snapPointToZoneBoundaries(
  point: Point,
  zones: RevealZone[],
  maxDistance: number,
  scaleX = 1,
  scaleY = 1,
): SnapResult {
  let bestPoint = normalizePoint(point);
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestZoneId: string | null = null;

  for (const zone of zones) {
    const boundary = zoneBoundaryPoints(zone);
    if (boundary.length < 2) continue;
    for (let index = 0; index < boundary.length; index += 1) {
      const candidate = closestPointOnSegment(
        point,
        boundary[index],
        boundary[(index + 1) % boundary.length],
        scaleX,
        scaleY,
      );
      if (candidate.distance < bestDistance) {
        bestDistance = candidate.distance;
        bestPoint = candidate.point;
        bestZoneId = zone.id;
      }
    }
  }

  if (bestDistance <= maxDistance) {
    return {
      point: normalizePoint(bestPoint),
      snapped: true,
      zoneId: bestZoneId,
    };
  }
  return {
    point: normalizePoint(point),
    snapped: false,
    zoneId: null,
  };
}

export function snapshotFog(scene: Scene): FogSnapshot {
  return {
    zones: structuredClone(scene.zones),
    strokes: structuredClone(scene.strokes),
  };
}

export function collectAssetIds(scenes: Scene[]): string[] {
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (scene.mapAssetId) ids.add(scene.mapAssetId);
    for (const assetId of scene.galleryAssetIds) ids.add(assetId);
  }
  return [...ids];
}

export function withTimestamp(scene: Scene): Scene {
  return { ...scene, updatedAt: new Date().toISOString() };
}
