export const PANEL_WIDTH_MIN = 0;
export const PANEL_WIDTH_MAX = 100;
export const DEFAULT_PANEL_WIDTH = 25;
export const SCENARIO_THEMES = [
  "medieval",
  "cyberpunk",
  "dark",
  "light",
  "gritty",
  "occult",
] as const;
export const DEFAULT_SCENARIO_THEME = "medieval";

export type ScenarioTheme = (typeof SCENARIO_THEMES)[number];

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
  scenarioMarkdown: string;
  scenarioTheme: ScenarioTheme;
  mapAssetId: string | null;
  galleryAssetIds: string[];
  activeImageId: string | null;
  imageViewports: Record<string, MapViewport>;
  panelVisible: boolean;
  panelWidth: number;
  outsideRevealed: boolean;
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
  outsideRevealed: boolean;
  zones: RevealZone[];
  strokes: RevealStroke[];
};

export type SnapResult = {
  point: Point;
  snapped: boolean;
  zoneId: string | null;
};

export type BoundaryMergeResult = {
  points: Point[];
  zones: RevealZone[];
  mergedZoneIds: string[];
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
    scenarioMarkdown: "",
    scenarioTheme: DEFAULT_SCENARIO_THEME,
    mapAssetId: null,
    galleryAssetIds: [],
    activeImageId: null,
    imageViewports: {},
    panelVisible: true,
    panelWidth: DEFAULT_PANEL_WIDTH,
    outsideRevealed: false,
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

export function isScenarioTheme(value: unknown): value is ScenarioTheme {
  return SCENARIO_THEMES.includes(value as ScenarioTheme);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampPanelWidth(value: number): number {
  return clamp(Math.round(value), PANEL_WIDTH_MIN, PANEL_WIDTH_MAX);
}

export function getImageViewport(
  scene: Pick<Scene, "imageViewports"> | null,
  assetId: string | null,
): MapViewport {
  const viewport = assetId ? scene?.imageViewports?.[assetId] : undefined;
  return {
    zoom: clamp(Number(viewport?.zoom) || 1, 0.75, 4),
    x: clamp(Number(viewport?.x) || 0, -1, 1),
    y: clamp(Number(viewport?.y) || 0, -1, 1),
  };
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

export function isPointInZone(
  point: Point,
  zone: RevealZone,
  boundaryTolerance = 0.000001,
): boolean {
  if (zone.points.length < 2) return false;
  if (zone.kind === "rect") {
    const [start, end] = zone.points;
    return (
      point.x >= Math.min(start.x, end.x) - boundaryTolerance &&
      point.x <= Math.max(start.x, end.x) + boundaryTolerance &&
      point.y >= Math.min(start.y, end.y) - boundaryTolerance &&
      point.y <= Math.max(start.y, end.y) + boundaryTolerance
    );
  }
  if (zone.points.length < 3) return false;

  for (let index = 0; index < zone.points.length; index += 1) {
    const boundaryPoint = closestPointOnSegment(
      point,
      zone.points[index],
      zone.points[(index + 1) % zone.points.length],
      1,
      1,
    );
    if (boundaryPoint.distance <= boundaryTolerance) return true;
  }

  let inside = false;
  for (
    let currentIndex = 0, previousIndex = zone.points.length - 1;
    currentIndex < zone.points.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = zone.points[currentIndex];
    const previous = zone.points[previousIndex];
    const crossesHorizontalRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crossesHorizontalRay) inside = !inside;
  }
  return inside;
}

function zoneArea(zone: RevealZone): number {
  if (zone.kind === "rect" && zone.points.length >= 2) {
    return (
      Math.abs(zone.points[1].x - zone.points[0].x) *
      Math.abs(zone.points[1].y - zone.points[0].y)
    );
  }
  if (zone.points.length < 3) return Number.POSITIVE_INFINITY;
  let doubleArea = 0;
  for (let index = 0; index < zone.points.length; index += 1) {
    const current = zone.points[index];
    const next = zone.points[(index + 1) % zone.points.length];
    doubleArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubleArea) / 2;
}

export function findZoneAtPoint(
  point: Point,
  zones: RevealZone[],
): RevealZone | null {
  let best: { zone: RevealZone; area: number } | null = null;
  for (const zone of zones) {
    if (!isPointInZone(point, zone)) continue;
    const area = zoneArea(zone);
    if (!best || area <= best.area) {
      best = { zone, area };
    }
  }
  return best?.zone ?? null;
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
): { point: Point; distance: number; progress: number } {
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
    progress,
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

type BoundaryLocation = {
  point: Point;
  segmentIndex: number;
  progress: number;
};

function pointsAreEqual(first: Point, second: Point, tolerance: number): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
}

function locatePointOnBoundary(
  point: Point,
  boundary: Point[],
  tolerance: number,
): BoundaryLocation | null {
  let best:
    | (BoundaryLocation & {
        distance: number;
      })
    | null = null;

  for (let index = 0; index < boundary.length; index += 1) {
    const candidate = closestPointOnSegment(
      point,
      boundary[index],
      boundary[(index + 1) % boundary.length],
      1,
      1,
    );
    if (!best || candidate.distance < best.distance) {
      best = {
        point: candidate.point,
        segmentIndex: index,
        progress: candidate.progress,
        distance: candidate.distance,
      };
    }
  }

  if (!best || best.distance > tolerance) return null;
  return {
    point: best.point,
    segmentIndex: best.segmentIndex,
    progress: best.progress,
  };
}

function appendDistinctPoint(
  points: Point[],
  point: Point,
  tolerance: number,
): void {
  const previous = points[points.length - 1];
  if (!previous || !pointsAreEqual(previous, point, tolerance)) {
    points.push(normalizePoint(point));
  }
}

function forwardBoundaryPath(
  boundary: Point[],
  start: BoundaryLocation,
  end: BoundaryLocation,
  tolerance: number,
): Point[] {
  const path: Point[] = [start.point];
  const startPosition = start.segmentIndex + start.progress;
  let endPosition = end.segmentIndex + end.progress;
  while (endPosition <= startPosition + tolerance) {
    endPosition += boundary.length;
  }

  for (
    let vertexPosition = Math.floor(startPosition) + 1;
    vertexPosition < endPosition - tolerance;
    vertexPosition += 1
  ) {
    appendDistinctPoint(
      path,
      boundary[vertexPosition % boundary.length],
      tolerance,
    );
  }
  appendDistinctPoint(path, end.point, tolerance);
  return path;
}

function pathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return length;
}

function sharedBoundaryPath(
  start: Point,
  end: Point,
  zone: RevealZone,
  tolerance: number,
  maxDetourRatio: number,
): Point[] | null {
  if (zone.kind !== "polygon" || zone.points.length < 3) return null;
  const startLocation = locatePointOnBoundary(start, zone.points, tolerance);
  const endLocation = locatePointOnBoundary(end, zone.points, tolerance);
  if (!startLocation || !endLocation) return null;

  const directLength = Math.hypot(end.x - start.x, end.y - start.y);
  if (directLength <= tolerance) return null;

  const forward = forwardBoundaryPath(
    zone.points,
    startLocation,
    endLocation,
    tolerance,
  );
  const backward = forwardBoundaryPath(
    zone.points,
    endLocation,
    startLocation,
    tolerance,
  ).reverse();
  const best =
    pathLength(forward) <= pathLength(backward) ? forward : backward;

  if (pathLength(best) > directLength * maxDetourRatio + tolerance) {
    return null;
  }
  return [start, ...best.slice(1, -1), end];
}

function bestSharedBoundaryMatch(
  start: Point,
  end: Point,
  zones: RevealZone[],
  tolerance: number,
  maxDetourRatio: number,
): { zone: RevealZone; path: Point[] } | null {
  let bestMatch:
    | { zone: RevealZone; path: Point[]; length: number }
    | null = null;

  for (const zone of zones) {
    const path = sharedBoundaryPath(
      start,
      end,
      zone,
      tolerance,
      maxDetourRatio,
    );
    if (!path) continue;
    const length = pathLength(path);
    if (!bestMatch || length < bestMatch.length) {
      bestMatch = { zone, path, length };
    }
  }

  return bestMatch
    ? { zone: bestMatch.zone, path: bestMatch.path }
    : null;
}

function insertPointsOnBoundary(
  boundary: Point[],
  candidates: Point[],
  tolerance: number,
): Point[] {
  const result: Point[] = [];

  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    appendDistinctPoint(result, start, tolerance);

    const insertions = candidates
      .map((point) => ({
        ...closestPointOnSegment(point, start, end, 1, 1),
        source: point,
      }))
      .filter(
        (candidate) =>
          candidate.distance <= tolerance &&
          candidate.progress > tolerance &&
          candidate.progress < 1 - tolerance,
      )
      .sort((first, second) => first.progress - second.progress);

    for (const insertion of insertions) {
      appendDistinctPoint(result, insertion.source, tolerance);
    }
  }

  if (
    result.length > 1 &&
    pointsAreEqual(result[0], result[result.length - 1], tolerance)
  ) {
    result.pop();
  }
  return result;
}

export function mergePolygonDraftBoundaries(
  points: Point[],
  zones: RevealZone[],
  tolerance = 0.000001,
  maxDetourRatio = 3,
): Point[] {
  if (points.length < 2) return points;
  const mergedPoints: Point[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = normalizePoint(points[index]);
    const end = normalizePoint(points[index + 1]);
    appendDistinctPoint(mergedPoints, start, tolerance);
    const match = bestSharedBoundaryMatch(
      start,
      end,
      zones,
      tolerance,
      maxDetourRatio,
    );
    if (!match) continue;
    for (const point of match.path.slice(1, -1)) {
      appendDistinctPoint(mergedPoints, point, tolerance);
    }
  }

  appendDistinctPoint(
    mergedPoints,
    normalizePoint(points[points.length - 1]),
    tolerance,
  );
  return mergedPoints;
}

/**
 * Makes a new polygon reuse adjacent polygon edges. Both polygons receive the
 * same junction vertices, so later rendering and fog reconstruction remain
 * deterministic at every resolution.
 */
export function mergePolygonBoundaries(
  points: Point[],
  zones: RevealZone[],
  tolerance = 0.000001,
  maxDetourRatio = 3,
): BoundaryMergeResult {
  if (points.length < 3) {
    return { points, zones, mergedZoneIds: [] };
  }

  const mergedPoints: Point[] = [];
  const sharedPointsByZone = new Map<string, Point[]>();

  for (let index = 0; index < points.length; index += 1) {
    const start = normalizePoint(points[index]);
    const end = normalizePoint(points[(index + 1) % points.length]);
    appendDistinctPoint(mergedPoints, start, tolerance);

    const bestMatch = bestSharedBoundaryMatch(
      start,
      end,
      zones,
      tolerance,
      maxDetourRatio,
    );

    if (!bestMatch) continue;
    const shared = sharedPointsByZone.get(bestMatch.zone.id) ?? [];
    shared.push(...bestMatch.path);
    sharedPointsByZone.set(bestMatch.zone.id, shared);
    for (const point of bestMatch.path.slice(1, -1)) {
      appendDistinctPoint(mergedPoints, point, tolerance);
    }
  }

  if (
    mergedPoints.length > 1 &&
    pointsAreEqual(
      mergedPoints[0],
      mergedPoints[mergedPoints.length - 1],
      tolerance,
    )
  ) {
    mergedPoints.pop();
  }

  return {
    points: mergedPoints,
    zones: zones.map((zone) => {
      const sharedPoints = sharedPointsByZone.get(zone.id);
      if (!sharedPoints || zone.kind !== "polygon") return zone;
      return {
        ...zone,
        points: insertPointsOnBoundary(
          zone.points,
          sharedPoints,
          tolerance,
        ),
      };
    }),
    mergedZoneIds: [...sharedPointsByZone.keys()],
  };
}

export function snapshotFog(scene: Scene): FogSnapshot {
  return {
    outsideRevealed: Boolean(scene.outsideRevealed),
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
