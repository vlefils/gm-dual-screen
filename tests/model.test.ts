import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PANEL_WIDTH,
  clampPanelWidth,
  collectAssetIds,
  createScene,
  isUsableRect,
  movePolygonVertex,
  snapPointToZoneBoundaries,
} from "../app/lib/model.ts";

test("une scène démarre avec un brouillard intact et un panneau à 25 %", () => {
  const scene = createScene();
  assert.equal(scene.panelWidth, DEFAULT_PANEL_WIDTH);
  assert.deepEqual(scene.zones, []);
  assert.deepEqual(scene.strokes, []);
  assert.deepEqual(scene.viewport, { zoom: 1, x: 0, y: 0 });
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
