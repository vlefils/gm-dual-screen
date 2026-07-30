import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PANEL_WIDTH,
  clampPanelWidth,
  collectAssetIds,
  createScene,
  findZoneAtPoint,
  isPointInZone,
  isUsableRect,
  mergePolygonBoundaries,
  mergePolygonDraftBoundaries,
  movePolygonVertex,
  snapPointToZoneBoundaries,
  snapshotFog,
} from "../app/lib/model.ts";

test("une scène démarre avec un brouillard intact et un panneau à 25 %", () => {
  const scene = createScene();
  assert.equal(scene.panelWidth, DEFAULT_PANEL_WIDTH);
  assert.deepEqual(scene.zones, []);
  assert.deepEqual(scene.strokes, []);
  assert.equal(scene.outsideRevealed, false);
  assert.deepEqual(scene.viewport, { zoom: 1, x: 0, y: 0 });
});

test("l’état hors zones est inclus dans l’historique du brouillard", () => {
  const scene = createScene();
  scene.outsideRevealed = true;
  assert.deepEqual(snapshotFog(scene), {
    outsideRevealed: true,
    zones: [],
    strokes: [],
  });
});

test("la largeur du panneau reste dans ses limites", () => {
  assert.equal(clampPanelWidth(8), 20);
  assert.equal(clampPanelWidth(34.6), 35);
  assert.equal(clampPanelWidth(90), 50);
});

test("les rectangles trop petits sont ignorés", () => {
  assert.equal(
    isUsableRect([
      { x: 0.2, y: 0.2 },
      { x: 0.205, y: 0.8 },
    ]),
    false,
  );
  assert.equal(
    isUsableRect([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ]),
    true,
  );
});

test("le ciblage reconnaît l’intérieur et la frontière des zones", () => {
  const polygon = {
    id: "zone-1",
    name: "Salle",
    kind: "polygon" as const,
    revealed: false,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.5, y: 0.8 },
    ],
  };
  const rectangle = {
    id: "zone-2",
    name: "Couloir",
    kind: "rect" as const,
    revealed: false,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
    ],
  };

  assert.equal(isPointInZone({ x: 0.5, y: 0.3 }, polygon), true);
  assert.equal(isPointInZone({ x: 0.45, y: 0.1 }, polygon), true);
  assert.equal(isPointInZone({ x: 0.95, y: 0.95 }, polygon), false);
  assert.equal(isPointInZone({ x: 0.3, y: 0.3 }, rectangle), true);
});

test("la plus petite zone est ciblée lorsque des zones se chevauchent", () => {
  const large = {
    id: "large",
    name: "Grande salle",
    kind: "rect" as const,
    revealed: false,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.9 },
    ],
  };
  const small = {
    id: "small",
    name: "Alcôve",
    kind: "polygon" as const,
    revealed: false,
    points: [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.5, y: 0.6 },
    ],
  };

  assert.equal(
    findZoneAtPoint({ x: 0.5, y: 0.5 }, [large, small])?.id,
    "small",
  );
  assert.equal(findZoneAtPoint({ x: 0.95, y: 0.95 }, [large, small]), null);
});

test("un sommet de polygone peut être déplacé sans modifier les autres", () => {
  const zone = {
    id: "zone-1",
    name: "Salle",
    kind: "polygon" as const,
    revealed: false,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.5, y: 0.8 },
    ],
  };
  const moved = movePolygonVertex(zone, 1, { x: 0.92, y: -0.2 });
  assert.deepEqual(moved.points, [
    { x: 0.1, y: 0.1 },
    { x: 0.92, y: 0 },
    { x: 0.5, y: 0.8 },
  ]);
  assert.notEqual(moved, zone);
});

test("un nouveau point s’accroche à l’arête d’une zone voisine", () => {
  const zone = {
    id: "zone-1",
    name: "Salle",
    kind: "polygon" as const,
    revealed: false,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.8 },
      { x: 0.1, y: 0.8 },
    ],
  };
  const snapped = snapPointToZoneBoundaries(
    { x: 0.51, y: 0.4 },
    [zone],
    2,
    100,
    100,
  );
  assert.equal(snapped.snapped, true);
  assert.ok(Math.abs(snapped.point.x - 0.5) < 1e-9);
  assert.ok(Math.abs(snapped.point.y - 0.4) < 1e-9);

  const distant = snapPointToZoneBoundaries(
    { x: 0.56, y: 0.4 },
    [zone],
    2,
    100,
    100,
  );
  assert.equal(distant.snapped, false);
  assert.deepEqual(distant.point, { x: 0.56, y: 0.4 });
});

test("un nouveau polygone reprend les angles d’une frontière adjacente", () => {
  const existing = {
    id: "zone-1",
    name: "Couloir",
    kind: "polygon" as const,
    revealed: false,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.5 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ],
  };

  const merged = mergePolygonBoundaries(
    [
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.5 },
      { x: 0.9, y: 0.2 },
    ],
    [existing],
  );

  assert.deepEqual(merged.points, [
    { x: 0.5, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.8, y: 0.5 },
    { x: 0.9, y: 0.2 },
  ]);
  assert.deepEqual(merged.mergedZoneIds, ["zone-1"]);
});

test("la fusion d’une frontière est visible pendant le tracé", () => {
  const existing = {
    id: "zone-1",
    name: "Couloir",
    kind: "polygon" as const,
    revealed: false,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.5 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ],
  };

  const preview = mergePolygonDraftBoundaries(
    [
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.5 },
      { x: 0.9, y: 0.2 },
    ],
    [existing],
  );

  assert.deepEqual(preview, [
    { x: 0.5, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.8, y: 0.5 },
    { x: 0.9, y: 0.2 },
  ]);
});

test("les points de jonction sont insérés dans les deux polygones", () => {
  const existing = {
    id: "zone-1",
    name: "Salle",
    kind: "polygon" as const,
    revealed: false,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  };

  const merged = mergePolygonBoundaries(
    [
      { x: 0.5, y: 0.3 },
      { x: 0.5, y: 0.7 },
      { x: 0.9, y: 0.7 },
      { x: 0.9, y: 0.3 },
    ],
    [existing],
  );

  assert.deepEqual(merged.points, [
    { x: 0.5, y: 0.3 },
    { x: 0.5, y: 0.7 },
    { x: 0.9, y: 0.7 },
    { x: 0.9, y: 0.3 },
  ]);
  assert.deepEqual(merged.zones[0].points, [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.5, y: 0.3 },
    { x: 0.5, y: 0.7 },
    { x: 0.5, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ]);
});

test("les identifiants d’images exportés sont uniques", () => {
  const first = createScene();
  first.mapAssetId = "map-1";
  first.galleryAssetIds = ["image-1", "image-1"];
  const second = createScene();
  second.mapAssetId = "map-1";
  second.galleryAssetIds = ["image-2"];
  assert.deepEqual(
    collectAssetIds([first, second]).sort(),
    ["image-1", "image-2", "map-1"],
  );
});
