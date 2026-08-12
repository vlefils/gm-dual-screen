"use client";

import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CHANNEL_NAME,
  PROTOCOL_VERSION,
  isProtocolMessage,
  type ProtocolMessage,
} from "./lib/protocol";
import {
  DEFAULT_PANEL_WIDTH,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  clamp,
  clampPanelWidth,
  cloneScene,
  createId,
  createScene,
  findZoneAtPoint,
  getImageViewport,
  isUsableRect,
  mergePolygonBoundaries,
  mergePolygonDraftBoundaries,
  movePolygonVertex,
  snapPointToZoneBoundaries,
  normalizePoint,
  snapshotFog,
  withTimestamp,
  type FogSnapshot,
  type AssetRecord,
  type MapViewport,
  type Point,
  type RevealStroke,
  type RevealZone,
  type Scene,
  type ZoneKind,
} from "./lib/model";
import {
  createBackup,
  getAsset,
  getScenes,
  getSetting,
  importBackup,
  putScene,
  removeScene,
  saveImageFile,
  setSetting,
} from "./lib/storage";
import {
  splitScenarioMarkdown,
  type EncounterSheetData,
} from "./lib/scenario";

type AppMode = "prepare" | "live" | "scenario";
type MapTool = "pan" | "rect" | "polygon" | "vertices" | "erase";
type Notice = { tone: "success" | "error"; text: string } | null;

const ACTIVE_SCENE_KEY = "activeSceneId";
const POLYGON_DRAFT_COLOR = "#58d6ff";
const OUTSIDE_ZONE_TARGET = "__outside-zones__";

function formatError(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "UnknownError")
  ) {
    return "Le navigateur n’a plus assez d’espace pour enregistrer ce fichier.";
  }
  return error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
}

function uniqueSceneName(scenes: Scene[], base: string): string {
  const names = new Set(scenes.map((scene) => scene.name));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useSceneAssetUrls(scene: Scene | null): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const assetKey = useMemo(() => {
    if (!scene) return "";
    const ids = new Set<string>();
    if (scene.mapAssetId) ids.add(scene.mapAssetId);
    for (const id of scene.galleryAssetIds) ids.add(id);
    return [...ids].sort().join("|");
  }, [scene]);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    const ids = assetKey ? assetKey.split("|") : [];
    void (async () => {
      const next = new Map<string, string>();
      for (const id of ids) {
        const asset = await getAsset(id);
        if (asset) {
          const url = URL.createObjectURL(asset.blob);
          objectUrls.push(url);
          next.set(id, url);
        }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [assetKey]);

  return urls;
}

function mapFitRect(
  width: number,
  height: number,
  image: HTMLImageElement,
): { x: number; y: number; width: number; height: number } {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const viewportRatio = width / height;
  if (imageRatio > viewportRatio) {
    const fittedHeight = width / imageRatio;
    return { x: 0, y: (height - fittedHeight) / 2, width, height: fittedHeight };
  }
  const fittedWidth = height * imageRatio;
  return { x: (width - fittedWidth) / 2, y: 0, width: fittedWidth, height };
}

function drawZonePath(
  context: CanvasRenderingContext2D,
  zone: RevealZone,
  mapRect: { x: number; y: number; width: number; height: number },
): void {
  if (zone.points.length < 2) return;
  const pointAt = (point: Point) => ({
    x: mapRect.x + point.x * mapRect.width,
    y: mapRect.y + point.y * mapRect.height,
  });

  context.beginPath();
  if (zone.kind === "rect") {
    const start = pointAt(zone.points[0]);
    const end = pointAt(zone.points[1]);
    context.rect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else {
    const start = pointAt(zone.points[0]);
    context.moveTo(start.x, start.y);
    for (const point of zone.points.slice(1)) {
      const current = pointAt(point);
      context.lineTo(current.x, current.y);
    }
    context.closePath();
  }
}

type MapStageProps = {
  scene: Scene | null;
  mapUrl?: string;
  interactive?: boolean;
  mode?: AppMode;
  tool?: MapTool;
  brushSize?: number;
  polygonDraft?: Point[];
  editingZoneId?: string | null;
  onPolygonDraftChange?: (points: Point[]) => void;
  onViewportChange?: (viewport: MapViewport) => void;
  onCreateZone?: (kind: ZoneKind, points: Point[]) => void;
  onMoveZoneVertex?: (
    zoneId: string,
    vertexIndex: number,
    point: Point,
  ) => void;
  onStroke?: (stroke: RevealStroke) => void;
  onToggleZone?: (zoneId: string) => void;
  onToggleOutside?: () => void;
};

function MapStage({
  scene,
  mapUrl,
  interactive = false,
  mode = "live",
  tool = "pan",
  brushSize = 4,
  polygonDraft = [],
  editingZoneId = null,
  onPolygonDraftChange,
  onViewportChange,
  onCreateZone,
  onMoveZoneVertex,
  onStroke,
  onToggleZone,
  onToggleOutside,
}: MapStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<
    | {
        kind: "pan";
        startX: number;
        startY: number;
        viewport: MapViewport;
        moved: boolean;
      }
    | { kind: "rect" }
    | { kind: "erase" }
    | { kind: "vertex"; zoneId: string; vertexIndex: number }
    | null
  >(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [draftRect, setDraftRect] = useState<Point[] | null>(null);
  const [draftStroke, setDraftStroke] = useState<Point[]>([]);
  const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const polygonPreview = useMemo(
    () =>
      mergePolygonDraftBoundaries(
        polygonDraft,
        scene?.zones ?? [],
      ),
    [polygonDraft, scene?.zones],
  );

  useEffect(() => {
    if (!mapUrl) {
      setImage(null);
      return;
    }
    const nextImage = new Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = mapUrl;
  }, [mapUrl]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () =>
      setSize({
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#080a0d";
    context.fillRect(0, 0, size.width, size.height);
    if (!image || !scene) return;

    const rect = mapFitRect(size.width, size.height, image);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);

    const fog = document.createElement("canvas");
    fog.width = Math.round(size.width * ratio);
    fog.height = Math.round(size.height * ratio);
    const fogContext = fog.getContext("2d");
    if (!fogContext) return;
    fogContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    const fogFillStyle =
      mode === "prepare"
        ? "rgba(5, 7, 10, 0.58)"
        : interactive
          ? "rgba(5, 7, 10, 0.88)"
          : "rgba(5, 7, 10, 0.97)";
    fogContext.fillStyle = fogFillStyle;
    fogContext.fillRect(rect.x, rect.y, rect.width, rect.height);

    if (scene.outsideRevealed) {
      fogContext.globalCompositeOperation = "destination-out";
      fogContext.fillRect(rect.x, rect.y, rect.width, rect.height);
      fogContext.globalCompositeOperation = "source-over";
      fogContext.fillStyle = fogFillStyle;
      for (const zone of scene.zones.filter((item) => !item.revealed)) {
        drawZonePath(fogContext, zone, rect);
        fogContext.fill();
      }
    }

    fogContext.globalCompositeOperation = "destination-out";

    for (const zone of scene.zones.filter((item) => item.revealed)) {
      drawZonePath(fogContext, zone, rect);
      fogContext.fill();
    }

    const strokes = draftStroke.length
      ? [
          ...scene.strokes,
          {
            id: "draft",
            points: draftStroke,
            radius: brushSize / 100,
          },
        ]
      : scene.strokes;
    for (const stroke of strokes) {
      if (!stroke.points.length) continue;
      fogContext.beginPath();
      fogContext.lineCap = "round";
      fogContext.lineJoin = "round";
      fogContext.lineWidth =
        Math.max(2, stroke.radius * Math.min(rect.width, rect.height) * 2);
      const first = stroke.points[0];
      fogContext.moveTo(
        rect.x + first.x * rect.width,
        rect.y + first.y * rect.height,
      );
      for (const point of stroke.points.slice(1)) {
        fogContext.lineTo(
          rect.x + point.x * rect.width,
          rect.y + point.y * rect.height,
        );
      }
      if (stroke.points.length === 1) {
        fogContext.lineTo(
          rect.x + first.x * rect.width + 0.01,
          rect.y + first.y * rect.height,
        );
      }
      fogContext.stroke();
    }

    context.drawImage(fog, 0, 0, size.width, size.height);

    if (interactive && mode === "live") {
      context.save();
      if (hoveredZoneId === OUTSIDE_ZONE_TARGET) {
        context.lineWidth = 3;
        context.strokeStyle = POLYGON_DRAFT_COLOR;
        context.setLineDash([9, 6]);
        context.strokeRect(
          rect.x + 2,
          rect.y + 2,
          Math.max(0, rect.width - 4),
          Math.max(0, rect.height - 4),
        );
      }
      for (const zone of scene.zones) {
        const isHovered = zone.id === hoveredZoneId;
        drawZonePath(context, zone, rect);
        if (isHovered) {
          context.fillStyle = "rgba(88, 214, 255, 0.12)";
          context.fill();
          drawZonePath(context, zone, rect);
        }
        context.lineWidth = isHovered ? 4 : 2;
        context.strokeStyle = isHovered
          ? POLYGON_DRAFT_COLOR
          : zone.revealed
            ? "#5ad4a4"
            : "#d7ad64";
        context.setLineDash(zone.revealed || isHovered ? [] : [7, 5]);
        context.stroke();
      }
      context.restore();
    }

    if (mode === "prepare") {
      context.save();
      context.lineWidth = 2;
      context.font = "600 12px Arial, sans-serif";
      for (const zone of scene.zones) {
        const isEditing = zone.id === editingZoneId;
        context.strokeStyle = isEditing
          ? "#f8d99d"
          : zone.revealed
            ? "#5ad4a4"
            : "#d7ad64";
        context.lineWidth = isEditing ? 3 : 2;
        context.fillStyle = "rgba(7, 9, 12, 0.82)";
        context.setLineDash(isEditing || zone.revealed ? [] : [6, 5]);
        drawZonePath(context, zone, rect);
        context.stroke();
        const anchor = zone.points[0];
        const labelX = rect.x + anchor.x * rect.width + 8;
        const labelY = rect.y + anchor.y * rect.height + 18;
        const labelWidth = context.measureText(zone.name).width + 14;
        context.fillRect(labelX - 4, labelY - 14, labelWidth, 21);
        context.fillStyle = "#f7f0e6";
        context.fillText(zone.name, labelX + 3, labelY);

        if (isEditing && zone.kind === "polygon") {
          context.setLineDash([]);
          for (const point of zone.points) {
            const x = rect.x + point.x * rect.width;
            const y = rect.y + point.y * rect.height;
            context.beginPath();
            context.arc(x, y, 7, 0, Math.PI * 2);
            context.fillStyle = "#0b0d10";
            context.fill();
            context.lineWidth = 3;
            context.strokeStyle = "#f0c97c";
            context.stroke();
            context.beginPath();
            context.arc(x, y, 2, 0, Math.PI * 2);
            context.fillStyle = "#f8e2b8";
            context.fill();
          }
        }
      }

      if (draftRect && draftRect.length === 2) {
        context.strokeStyle = "#f0c97c";
        context.setLineDash([5, 4]);
        drawZonePath(
          context,
          {
            id: "draft",
            name: "",
            kind: "rect",
            revealed: false,
            points: draftRect,
          },
          rect,
        );
        context.stroke();
      }

      if (polygonPreview.length) {
        context.beginPath();
        context.strokeStyle = POLYGON_DRAFT_COLOR;
        context.lineWidth = 3;
        context.setLineDash([5, 4]);
        polygonPreview.forEach((point, index) => {
          const x = rect.x + point.x * rect.width;
          const y = rect.y + point.y * rect.height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();

        context.setLineDash([]);
        polygonDraft.forEach((point) => {
          const x = rect.x + point.x * rect.width;
          const y = rect.y + point.y * rect.height;
          context.beginPath();
          context.fillStyle = "#08141a";
          context.arc(x, y, 5, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.fillStyle = POLYGON_DRAFT_COLOR;
          context.arc(x, y, 3, 0, Math.PI * 2);
          context.fill();
        });
      }

      if (snapIndicator) {
        const x = rect.x + snapIndicator.x * rect.width;
        const y = rect.y + snapIndicator.y * rect.height;
        context.setLineDash([]);
        context.beginPath();
        context.arc(x, y, 10, 0, Math.PI * 2);
        context.fillStyle =
          tool === "polygon"
            ? "rgba(88, 214, 255, 0.18)"
            : "rgba(240, 201, 124, 0.16)";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle =
          tool === "polygon" ? POLYGON_DRAFT_COLOR : "#f8d99d";
        context.stroke();
        context.beginPath();
        context.arc(x, y, 3, 0, Math.PI * 2);
        context.fillStyle =
          tool === "polygon" ? POLYGON_DRAFT_COLOR : "#f8e2b8";
        context.fill();
      }
      context.restore();
    }
  }, [
    brushSize,
    draftRect,
    draftStroke,
    editingZoneId,
    hoveredZoneId,
    image,
    interactive,
    mode,
    polygonDraft,
    polygonPreview,
    scene,
    size,
    snapIndicator,
    tool,
  ]);

  const eventPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      clampToMap = true,
    ): Point | null => {
      const container = containerRef.current;
      if (!container || !image || !scene) return null;
      const bounds = container.getBoundingClientRect();
      const viewport = scene.viewport;
      const rawX =
        (clientX - bounds.left - bounds.width / 2 - viewport.x * bounds.width) /
          viewport.zoom +
        bounds.width / 2;
      const rawY =
        (clientY - bounds.top - bounds.height / 2 - viewport.y * bounds.height) /
          viewport.zoom +
        bounds.height / 2;
      const fitted = mapFitRect(bounds.width, bounds.height, image);
      const point = {
        x: (rawX - fitted.x) / fitted.width,
        y: (rawY - fitted.y) / fitted.height,
      };
      if (
        !clampToMap &&
        (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)
      ) {
        return null;
      }
      return normalizePoint(point);
    },
    [image, scene],
  );

  const snapCreationPoint = useCallback(
    (point: Point) => {
      const container = containerRef.current;
      if (!container || !image || !scene) {
        return { point, snapped: false, zoneId: null };
      }
      const bounds = container.getBoundingClientRect();
      const fitted = mapFitRect(bounds.width, bounds.height, image);
      return snapPointToZoneBoundaries(
        point,
        scene.zones,
        14,
        fitted.width * scene.viewport.zoom,
        fitted.height * scene.viewport.zoom,
      );
    },
    [image, scene],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !scene || !image) return;
    if (tool === "vertices" && editingZoneId) {
      const point = eventPoint(event.clientX, event.clientY);
      const zone = scene.zones.find(
        (item) => item.id === editingZoneId && item.kind === "polygon",
      );
      const container = containerRef.current;
      if (!point || !zone || !container) return;
      const bounds = container.getBoundingClientRect();
      const fitted = mapFitRect(bounds.width, bounds.height, image);
      let nearestIndex = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      zone.points.forEach((vertex, index) => {
        const distance = Math.hypot(
          (vertex.x - point.x) * fitted.width * scene.viewport.zoom,
          (vertex.y - point.y) * fitted.height * scene.viewport.zoom,
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      if (nearestIndex >= 0 && nearestDistance <= 20) {
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = {
          kind: "vertex",
          zoneId: zone.id,
          vertexIndex: nearestIndex,
        };
      }
      return;
    }
    if (tool === "pan") {
      setHoveredZoneId(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = {
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        viewport: scene.viewport,
        moved: false,
      };
      return;
    }
    const rawPoint = eventPoint(event.clientX, event.clientY);
    if (!rawPoint) return;
    if (tool === "polygon") {
      const snapped = snapCreationPoint(rawPoint);
      setSnapIndicator(snapped.snapped ? snapped.point : null);
      const point = snapped.point;
      onPolygonDraftChange?.([...polygonDraft, point]);
      return;
    }
    const point =
      tool === "rect" ? snapCreationPoint(rawPoint).point : rawPoint;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "rect") {
      const snapped = snapCreationPoint(rawPoint);
      setSnapIndicator(snapped.snapped ? snapped.point : null);
      gestureRef.current = { kind: "rect" };
      setDraftRect([snapped.point, snapped.point]);
    } else if (tool === "erase") {
      gestureRef.current = { kind: "erase" };
      setDraftStroke([point]);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!scene) return;
    if (!gesture && mode === "live" && tool === "pan") {
      const point = eventPoint(event.clientX, event.clientY, false);
      const zone = point ? findZoneAtPoint(point, scene.zones) : null;
      setHoveredZoneId(
        point ? (zone?.id ?? OUTSIDE_ZONE_TARGET) : null,
      );
      return;
    }
    if (!gesture && tool === "polygon") {
      const rawPoint = eventPoint(event.clientX, event.clientY);
      if (!rawPoint) return;
      const snapped = snapCreationPoint(rawPoint);
      setSnapIndicator(snapped.snapped ? snapped.point : null);
      return;
    }
    if (!gesture) return;
    if (gesture.kind === "pan") {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      if (
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ) >= 5
      ) {
        gesture.moved = true;
      }
      if (!gesture.moved) return;
      onViewportChange?.({
        ...gesture.viewport,
        x: clamp(
          gesture.viewport.x + (event.clientX - gesture.startX) / bounds.width,
          -1,
          1,
        ),
        y: clamp(
          gesture.viewport.y + (event.clientY - gesture.startY) / bounds.height,
          -1,
          1,
        ),
      });
      return;
    }
    const rawPoint = eventPoint(event.clientX, event.clientY);
    if (!rawPoint) return;
    if (gesture.kind === "vertex") {
      onMoveZoneVertex?.(gesture.zoneId, gesture.vertexIndex, rawPoint);
    } else if (gesture.kind === "rect") {
      const snapped = snapCreationPoint(rawPoint);
      setSnapIndicator(snapped.snapped ? snapped.point : null);
      setDraftRect((current) =>
        current
          ? [current[0], snapped.point]
          : [snapped.point, snapped.point],
      );
    } else if (gesture.kind === "erase") {
      const point = rawPoint;
      setDraftStroke((current) => {
        const previous = current[current.length - 1];
        if (
          previous &&
          Math.hypot(previous.x - point.x, previous.y - point.y) < 0.004
        ) {
          return current;
        }
        return [...current, point];
      });
    }
  };

  const finishGesture = (
    event?: ReactPointerEvent<HTMLCanvasElement>,
    cancelled = false,
  ) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (
      gesture.kind === "pan" &&
      !gesture.moved &&
      !cancelled &&
      event &&
      mode === "live"
    ) {
      const point = eventPoint(event.clientX, event.clientY, false);
      const zone = point ? findZoneAtPoint(point, scene?.zones ?? []) : null;
      if (zone) onToggleZone?.(zone.id);
      else if (point) onToggleOutside?.();
      setHoveredZoneId(
        point ? (zone?.id ?? OUTSIDE_ZONE_TARGET) : null,
      );
    }
    if (gesture.kind === "rect" && draftRect && isUsableRect(draftRect)) {
      onCreateZone?.("rect", draftRect);
    }
    if (gesture.kind === "erase" && draftStroke.length) {
      onStroke?.({
        id: createId("stroke"),
        points: draftStroke,
        radius: brushSize / 100,
      });
    }
    gestureRef.current = null;
    setDraftRect(null);
    setDraftStroke([]);
    setSnapIndicator(null);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!interactive || !scene || mode !== "live") return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    onViewportChange?.({
      ...scene.viewport,
      zoom: clamp(scene.viewport.zoom * factor, 0.75, 4),
    });
  };

  const viewport = scene?.viewport ?? { zoom: 1, x: 0, y: 0 };
  return (
    <div
      ref={containerRef}
      className={`map-stage map-tool-${tool}`}
      data-empty={!mapUrl}
      data-zone-hovered={
        interactive &&
        mode === "live" &&
        tool === "pan" &&
        Boolean(hoveredZoneId)
      }
    >
      <canvas
        ref={canvasRef}
        aria-label={
          interactive
            ? mode === "live"
              ? "Carte interactive : cliquez une zone ou le fond pour changer sa visibilité"
              : "Carte interactive et brouillard de guerre"
            : "Carte des joueurs"
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={(event) => finishGesture(event, true)}
        onPointerLeave={() => {
          if (!gestureRef.current) {
            setSnapIndicator(null);
            setHoveredZoneId(null);
          }
        }}
        onWheel={handleWheel}
        style={{
          transform: `translate(${viewport.x * 100}%, ${viewport.y * 100}%) scale(${viewport.zoom})`,
        }}
      />
      {!mapUrl && (
        <div className="stage-empty">
          <span className="stage-empty-mark" aria-hidden="true">
            ◫
          </span>
          <strong>Aucune carte chargée</strong>
          <span>Importez une carte depuis la console MJ.</span>
        </div>
      )}
    </div>
  );
}

type PlayerFrameProps = MapStageProps & {
  assetUrls: Map<string, string>;
  className?: string;
  onImageViewportChange?: (viewport: MapViewport) => void;
};

function ImageStage({
  src,
  viewport,
  interactive = false,
  onViewportChange,
}: {
  src: string;
  viewport: MapViewport;
  interactive?: boolean;
  onViewportChange?: (viewport: MapViewport) => void;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    viewport: MapViewport;
  } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!interactive || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      viewport,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!gesture || !bounds) return;
    onViewportChange?.({
      ...gesture.viewport,
      x: clamp(
        gesture.viewport.x + (event.clientX - gesture.startX) / bounds.width,
        -1,
        1,
      ),
      y: clamp(
        gesture.viewport.y + (event.clientY - gesture.startY) / bounds.height,
        -1,
        1,
      ),
    });
  };

  const finishGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gestureRef.current = null;
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!interactive) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    onViewportChange?.({
      ...viewport,
      zoom: clamp(viewport.zoom * factor, 0.75, 4),
    });
  };

  return (
    <aside
      ref={containerRef}
      className={`player-image-panel ${interactive ? "is-interactive" : ""}`}
      aria-label={
        interactive
          ? "Illustration interactive : glissez pour la recadrer et utilisez la molette pour zoomer"
          : "Illustration"
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onWheel={handleWheel}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          transform: `translate(${viewport.x * 100}%, ${viewport.y * 100}%) scale(${viewport.zoom})`,
        }}
      />
    </aside>
  );
}

function PlayerFrame({
  scene,
  assetUrls,
  className = "",
  onImageViewportChange,
  ...mapProps
}: PlayerFrameProps) {
  const mapUrl = scene?.mapAssetId
    ? assetUrls.get(scene.mapAssetId)
    : undefined;
  const imageUrl = scene?.activeImageId
    ? assetUrls.get(scene.activeImageId)
    : undefined;
  const panelWidth = clampPanelWidth(
    scene?.panelWidth ?? DEFAULT_PANEL_WIDTH,
  );
  const showPanel = Boolean(
    scene?.panelVisible && imageUrl && panelWidth > PANEL_WIDTH_MIN,
  );
  const showMap = !showPanel || panelWidth < PANEL_WIDTH_MAX;
  const layout = showMap && showPanel ? "split" : showPanel ? "image" : "map";
  const imageViewport = getImageViewport(
    scene,
    scene?.activeImageId ?? null,
  );
  const imageInteractive = Boolean(
    mapProps.interactive && mapProps.mode === "live",
  );

  return (
    <div
      className={`player-frame ${className}`}
      data-layout={layout}
      style={{
        gridTemplateColumns:
          layout === "split"
            ? `minmax(0, 1fr) ${panelWidth}%`
            : "minmax(0, 1fr)",
      }}
    >
      {showMap && <MapStage scene={scene} mapUrl={mapUrl} {...mapProps} />}
      {showPanel && imageUrl && (
        <ImageStage
          src={imageUrl}
          viewport={imageViewport}
          interactive={imageInteractive}
          onViewportChange={onImageViewportChange}
        />
      )}
    </div>
  );
}

function PlayerView() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [connected, setConnected] = useState(false);
  const assetUrls = useSceneAssetUrls(scene);

  useEffect(() => {
    void (async () => {
      const activeId = await getSetting(ACTIVE_SCENE_KEY);
      const scenes = await getScenes();
      setScene(scenes.find((item) => item.id === activeId) ?? scenes[0] ?? null);
    })();

    const channel = new BroadcastChannel(CHANNEL_NAME);
    const announce = () => {
      const message: ProtocolMessage = {
        version: PROTOCOL_VERSION,
        type: "PLAYER_READY",
      };
      channel.postMessage(message);
    };
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isProtocolMessage(event.data)) return;
      if (
        event.data.type === "STATE_SNAPSHOT" ||
        event.data.type === "STATE_PATCH"
      ) {
        setScene(event.data.scene);
        setConnected(true);
      } else if (event.data.type === "PING") {
        channel.postMessage({
          version: PROTOCOL_VERSION,
          type: "PONG",
          sentAt: event.data.sentAt,
        } satisfies ProtocolMessage);
        setConnected(true);
      }
    };
    announce();
    const interval = window.setInterval(announce, 4000);
    return () => {
      window.clearInterval(interval);
      channel.close();
    };
  }, []);

  return (
    <main className="player-shell">
      <PlayerFrame scene={scene} assetUrls={assetUrls} />
      <div className="player-utility">
        <span className={connected ? "live-dot is-online" : "live-dot"} />
        <button
          type="button"
          onClick={() => void document.documentElement.requestFullscreen()}
        >
          Plein écran
        </button>
      </div>
    </main>
  );
}

function MarkdownContent({
  markdown,
  className = "scenario-markdown",
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => {
            void node;
            return (
              <a {...props} target="_blank" rel="noreferrer noopener" />
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function EncounterSheet({ sheet }: { sheet: EncounterSheetData }) {
  return (
    <article
      className={`encounter-sheet encounter-level-${sheet.headingLevel}`}
      aria-label={`Fiche de ${sheet.title}`}
    >
      <header className="encounter-header">
        <div className="encounter-heading-row">
          <div>
            <span className="encounter-kicker">Encounter détecté</span>
            <h1>{sheet.title}</h1>
          </div>
          {sheet.challengeRating && (
            <span className="encounter-rating">{sheet.challengeRating}</span>
          )}
        </div>
        {sheet.subtitle && <p className="encounter-subtitle">{sheet.subtitle}</p>}
      </header>

      {sheet.descriptionMarkdown && (
        <MarkdownContent
          markdown={sheet.descriptionMarkdown}
          className="encounter-description scenario-markdown"
        />
      )}

      <div className="encounter-stat-block">
        <dl className="encounter-vitals">
          {sheet.vitals.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>

        <dl className="encounter-abilities">
          {sheet.abilities.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>

        {sheet.details.length > 0 && (
          <dl className="encounter-details">
            {sheet.details.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {sheet.bodyMarkdown && (
        <MarkdownContent
          markdown={sheet.bodyMarkdown}
          className="encounter-body scenario-markdown"
        />
      )}
    </article>
  );
}

function ScenarioWorkspace({
  scene,
  scenes,
  activeSceneId,
  editorVisible,
  onSceneChange,
  onEditorVisibleChange,
  onMarkdownChange,
}: {
  scene: Scene | null;
  scenes: Scene[];
  activeSceneId: string;
  editorVisible: boolean;
  onSceneChange: (sceneId: string) => void;
  onEditorVisibleChange: (visible: boolean) => void;
  onMarkdownChange: (markdown: string) => void;
}) {
  const markdown = scene?.scenarioMarkdown ?? "";
  const wordCount = markdown.trim()
    ? markdown.trim().split(/\s+/u).length
    : 0;
  const lineCount = markdown ? markdown.split(/\r\n|\r|\n/u).length : 0;
  const scenarioSegments = useMemo(
    () => splitScenarioMarkdown(markdown),
    [markdown],
  );
  const encounterCount = scenarioSegments.filter(
    (segment) => segment.kind === "encounter",
  ).length;

  return (
    <section className="scenario-workspace" aria-label="Scénario de la scène">
      <header className="scenario-toolbar">
        <div className="scenario-scene-picker">
          <label htmlFor="scenario-scene">Scénario de</label>
          <select
            id="scenario-scene"
            value={activeSceneId}
            onChange={(event) => onSceneChange(event.target.value)}
          >
            {scenes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="scenario-toolbar-meta">
          <div className="scenario-stats" aria-label="Statistiques du scénario">
            <span>{wordCount.toLocaleString("fr-FR")} mots</span>
            <span>{lineCount.toLocaleString("fr-FR")} lignes</span>
            <span className="scenario-encounter-count">
              {encounterCount
                ? `${encounterCount} fiche${encounterCount > 1 ? "s" : ""} détectée${encounterCount > 1 ? "s" : ""}`
                : "Détection auto"}
            </span>
            <span className="scenario-saved">Enregistrement automatique</span>
          </div>
          <button
            type="button"
            className="scenario-view-toggle"
            aria-controls="scenario-editor-panel"
            aria-pressed={!editorVisible}
            onClick={() => onEditorVisibleChange(!editorVisible)}
          >
            {editorVisible ? "Masquer l’éditeur" : "Afficher l’éditeur"}
          </button>
        </div>
      </header>

      <div className={`scenario-split ${editorVisible ? "" : "is-reading"}`}>
        {editorVisible && (
          <section className="scenario-editor-panel" id="scenario-editor-panel">
            <div className="scenario-panel-heading">
              <div>
                <span className="section-eyebrow">MANUSCRIT</span>
                <h1>Édition Markdown</h1>
              </div>
              <span className="scenario-format-hint">
                # Titre · **gras** · &gt; citation
              </span>
            </div>
            <textarea
              className="scenario-editor"
              aria-label="Texte du scénario en Markdown"
              value={markdown}
              onChange={(event) => onMarkdownChange(event.target.value)}
              placeholder={
                "# La Crypte du roi sans nom\n\n> À lire à voix haute : une brume froide rampe entre les pierres.\n\n## Entrée dans les ruines\n\n- **Objectif :** retrouver le sceau brisé\n- **Danger :** 3 gardiens spectraux\n\n---\n\n### Si les héros fouillent l’autel\n\nIls découvrent une clé d’obsidienne."
              }
              spellCheck
            />
            <footer className="scenario-editor-footer">
              Markdown standard · fiches de rencontre détectées automatiquement
            </footer>
          </section>
        )}

        <section className="scenario-preview-panel" aria-label="Aperçu du scénario">
          <article
            className={`scenario-page ${encounterCount ? "has-encounter" : ""}`}
          >
            <header className="scenario-page-header">
              <span>Chronique du maître du jeu</span>
              <h2>{scene?.name ?? "Scène sans titre"}</h2>
              <div className="scenario-ornament" aria-hidden="true">
                <span />
                ◆
                <span />
              </div>
            </header>
            {markdown.trim() ? (
              <div className="scenario-document">
                {scenarioSegments.map((segment, index) =>
                  segment.kind === "encounter" ? (
                    <EncounterSheet key={`encounter-${index}`} sheet={segment.sheet} />
                  ) : (
                    <MarkdownContent
                      key={`markdown-${index}`}
                      markdown={segment.markdown}
                    />
                  ),
                )}
              </div>
            ) : (
              <div className="scenario-empty">
                <span className="scenario-empty-mark" aria-hidden="true">✦</span>
                <h3>Votre aventure commence ici</h3>
                <p>
                  Collez votre scénario dans le manuscrit. Les titres, citations,
                  listes, tableaux et notes prendront forme dans cet aperçu.
                </p>
              </div>
            )}
          </article>
        </section>
      </div>
    </section>
  );
}

function ControllerView() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState("");
  const [mode, setMode] = useState<AppMode>("prepare");
  const [scenarioEditorVisible, setScenarioEditorVisible] = useState(true);
  const [tool, setTool] = useState<MapTool>("rect");
  const [brushSize, setBrushSize] = useState(4);
  const [polygonDraft, setPolygonDraft] = useState<Point[]>([]);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [playerConnected, setPlayerConnected] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const scenesRef = useRef<Scene[]>([]);
  const activeSceneIdRef = useRef("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastPongRef = useRef(0);
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const historyRef = useRef<Map<string, FogSnapshot[]>>(new Map());

  const activeScene =
    scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0] ?? null;
  const assetUrls = useSceneAssetUrls(activeScene);

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  useEffect(() => {
    activeSceneIdRef.current = activeSceneId;
  }, [activeSceneId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    void (async () => {
      try {
        let storedScenes = await getScenes();
        if (!storedScenes.length) {
          const first = createScene(1);
          await putScene(first);
          storedScenes = [first];
        }
        const storedActiveId = await getSetting(ACTIVE_SCENE_KEY);
        const initialId = storedScenes.some(
          (scene) => scene.id === storedActiveId,
        )
          ? String(storedActiveId)
          : storedScenes[0].id;
        scenesRef.current = storedScenes;
        activeSceneIdRef.current = initialId;
        setScenes(storedScenes);
        setActiveSceneId(initialId);
        await setSetting(ACTIVE_SCENE_KEY, initialId);
      } catch (error) {
        setNotice({ tone: "error", text: formatError(error) });
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const currentSceneFromRefs = useCallback(() => {
    return (
      scenesRef.current.find(
        (scene) => scene.id === activeSceneIdRef.current,
      ) ?? null
    );
  }, []);

  useEffect(() => {
    if (initializing) return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isProtocolMessage(event.data)) return;
      if (event.data.type === "PLAYER_READY") {
        lastPongRef.current = Date.now();
        setPlayerConnected(true);
        channel.postMessage({
          version: PROTOCOL_VERSION,
          type: "STATE_SNAPSHOT",
          scene: currentSceneFromRefs(),
        } satisfies ProtocolMessage);
      }
      if (event.data.type === "PONG") {
        lastPongRef.current = Date.now();
        setPlayerConnected(true);
      }
    };
    const interval = window.setInterval(() => {
      channel.postMessage({
        version: PROTOCOL_VERSION,
        type: "PING",
        sentAt: Date.now(),
      } satisfies ProtocolMessage);
      if (Date.now() - lastPongRef.current > 7000) setPlayerConnected(false);
    }, 3000);
    return () => {
      window.clearInterval(interval);
      channel.close();
      channelRef.current = null;
    };
  }, [currentSceneFromRefs, initializing]);

  const queueSave = useCallback((scene: Scene) => {
    const existing = saveTimersRef.current.get(scene.id);
    if (existing) window.clearTimeout(existing);
    const timeout = window.setTimeout(() => {
      void putScene(scene).catch((error) =>
        setNotice({ tone: "error", text: formatError(error) }),
      );
      saveTimersRef.current.delete(scene.id);
    }, 220);
    saveTimersRef.current.set(scene.id, timeout);
  }, []);

  const commitScene = useCallback(
    (scene: Scene, messageType: "STATE_PATCH" | "STATE_SNAPSHOT" = "STATE_PATCH") => {
      const stamped = withTimestamp(scene);
      const nextScenes = scenesRef.current.map((item) =>
        item.id === stamped.id ? stamped : item,
      );
      scenesRef.current = nextScenes;
      setScenes(nextScenes);
      queueSave(stamped);
      channelRef.current?.postMessage({
        version: PROTOCOL_VERSION,
        type: messageType,
        scene: stamped,
      } satisfies ProtocolMessage);
    },
    [queueSave],
  );

  const changeActiveScene = useCallback((sceneId: string) => {
    activeSceneIdRef.current = sceneId;
    setActiveSceneId(sceneId);
    setPolygonDraft([]);
    setEditingZoneId(null);
    void setSetting(ACTIVE_SCENE_KEY, sceneId);
    const scene = scenesRef.current.find((item) => item.id === sceneId) ?? null;
    channelRef.current?.postMessage({
      version: PROTOCOL_VERSION,
      type: "STATE_SNAPSHOT",
      scene,
    } satisfies ProtocolMessage);
  }, []);

  const updateActiveScene = useCallback(
    (update: (scene: Scene) => Scene) => {
      const current = currentSceneFromRefs();
      if (!current) return;
      commitScene(update(current));
    },
    [commitScene, currentSceneFromRefs],
  );

  const rememberFog = useCallback((scene: Scene) => {
    const currentHistory = historyRef.current.get(scene.id) ?? [];
    historyRef.current.set(scene.id, [
      ...currentHistory.slice(-19),
      snapshotFog(scene),
    ]);
  }, []);

  const setAppMode = (nextMode: AppMode) => {
    setMode(nextMode);
    setPolygonDraft([]);
    setEditingZoneId(null);
    setTool(nextMode === "prepare" ? "rect" : "pan");
  };

  const addScene = async () => {
    const scene = createScene(scenesRef.current.length + 1);
    scene.name = uniqueSceneName(scenesRef.current, scene.name);
    await putScene(scene);
    const next = [...scenesRef.current, scene];
    scenesRef.current = next;
    setScenes(next);
    changeActiveScene(scene.id);
  };

  const duplicateActiveScene = async () => {
    const current = currentSceneFromRefs();
    if (!current) return;
    const scene = cloneScene(
      current,
      uniqueSceneName(scenesRef.current, `${current.name} copie`),
    );
    await putScene(scene);
    const next = [...scenesRef.current, scene];
    scenesRef.current = next;
    setScenes(next);
    changeActiveScene(scene.id);
    setNotice({ tone: "success", text: "Scène dupliquée." });
  };

  const deleteActiveScene = async () => {
    const current = currentSceneFromRefs();
    if (!current || scenesRef.current.length <= 1) return;
    if (!window.confirm(`Supprimer définitivement « ${current.name} » ?`)) {
      return;
    }
    const next = scenesRef.current.filter((scene) => scene.id !== current.id);
    await removeScene(current.id);
    scenesRef.current = next;
    setScenes(next);
    changeActiveScene(next[0].id);
  };

  const importMap = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const asset = await saveImageFile(file);
      updateActiveScene((scene) => ({
        ...scene,
        mapAssetId: asset.id,
        outsideRevealed: false,
        zones: [],
        strokes: [],
        viewport: { zoom: 1, x: 0, y: 0 },
      }));
      setNotice({ tone: "success", text: "Carte enregistrée localement." });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error) });
    }
  };

  const importGallery = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    try {
      const assets: AssetRecord[] = [];
      for (const file of files) assets.push(await saveImageFile(file));
      updateActiveScene((scene) => ({
        ...scene,
        galleryAssetIds: [
          ...scene.galleryAssetIds,
          ...assets.map((asset) => asset.id),
        ],
        activeImageId:
          scene.activeImageId ?? assets[0]?.id ?? scene.activeImageId,
      }));
      setNotice({
        tone: "success",
        text: `${assets.length} illustration${assets.length > 1 ? "s" : ""} ajoutée${assets.length > 1 ? "s" : ""}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error) });
    }
  };

  const addZone = useCallback(
    (kind: ZoneKind, points: Point[]) => {
      updateActiveScene((scene) => {
        const merged =
          kind === "polygon"
            ? mergePolygonBoundaries(points, scene.zones)
            : { points, zones: scene.zones };
        return {
          ...scene,
          zones: [
            ...merged.zones,
            {
              id: createId("zone"),
              name: `Zone ${scene.zones.length + 1}`,
              kind,
              points: merged.points,
              revealed: false,
            },
          ],
        };
      });
    },
    [updateActiveScene],
  );

  const finishPolygon = () => {
    if (polygonDraft.length < 3) return;
    addZone("polygon", polygonDraft);
    setPolygonDraft([]);
  };

  const moveZoneVertex = useCallback(
    (zoneId: string, vertexIndex: number, point: Point) => {
      updateActiveScene((scene) => ({
        ...scene,
        zones: scene.zones.map((zone) =>
          zone.id === zoneId
            ? movePolygonVertex(zone, vertexIndex, point)
            : zone,
        ),
      }));
    },
    [updateActiveScene],
  );

  const toggleZone = (zoneId: string) => {
    const current = currentSceneFromRefs();
    if (!current) return;
    rememberFog(current);
    commitScene({
      ...current,
      zones: current.zones.map((zone) =>
        zone.id === zoneId ? { ...zone, revealed: !zone.revealed } : zone,
      ),
    });
  };

  const toggleOutside = () => {
    const current = currentSceneFromRefs();
    if (!current) return;
    rememberFog(current);
    commitScene({
      ...current,
      outsideRevealed: !current.outsideRevealed,
    });
  };

  const addStroke = useCallback(
    (stroke: RevealStroke) => {
      const current = currentSceneFromRefs();
      if (!current) return;
      rememberFog(current);
      commitScene({ ...current, strokes: [...current.strokes, stroke] });
    },
    [commitScene, currentSceneFromRefs, rememberFog],
  );

  const undoFog = () => {
    const current = currentSceneFromRefs();
    if (!current) return;
    const history = historyRef.current.get(current.id) ?? [];
    const previous = history.at(-1);
    if (!previous) return;
    historyRef.current.set(current.id, history.slice(0, -1));
    commitScene({
      ...current,
      outsideRevealed: previous.outsideRevealed,
      zones: previous.zones,
      strokes: previous.strokes,
    });
  };

  const resetFog = () => {
    const current = currentSceneFromRefs();
    if (!current) return;
    if (!window.confirm("Recouvrir toute la carte et effacer les révélations ?")) {
      return;
    }
    rememberFog(current);
    commitScene({
      ...current,
      outsideRevealed: false,
      zones: current.zones.map((zone) => ({ ...zone, revealed: false })),
      strokes: [],
    });
  };

  const openPlayerWindow = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "player");
    const player = window.open(
      url,
      "ecran-du-mj-joueurs",
      "popup=yes,width=1280,height=720",
    );
    if (!player) {
      setNotice({
        tone: "error",
        text: "La fenêtre a été bloquée. Autorisez les fenêtres surgissantes pour ce site.",
      });
    }
  };

  const exportAll = async () => {
    try {
      const blob = await createBackup(scenesRef.current);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `ecran-du-mj-${date}.mjscreen`);
      setNotice({ tone: "success", text: "Sauvegarde complète exportée." });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error) });
    }
  };

  const importAll = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = await importBackup(file, scenesRef.current);
      if (!imported.length) throw new Error("La sauvegarde ne contient aucune scène.");
      const next = [...scenesRef.current, ...imported];
      scenesRef.current = next;
      setScenes(next);
      changeActiveScene(imported[0].id);
      setNotice({
        tone: "success",
        text: `${imported.length} scène${imported.length > 1 ? "s" : ""} importée${imported.length > 1 ? "s" : ""}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: formatError(error) });
    }
  };

  if (initializing) {
    return (
      <main className="loading-shell">
        <div className="loading-mark">MJ</div>
        <p>Ouverture de votre table…</p>
      </main>
    );
  }

  const currentHistory = activeScene
    ? historyRef.current.get(activeScene.id) ?? []
    : [];
  const effectivePanelWidth = activeScene?.panelVisible
    ? clampPanelWidth(activeScene.panelWidth)
    : PANEL_WIDTH_MIN;
  const effectiveMapWidth = PANEL_WIDTH_MAX - effectivePanelWidth;
  const activeImageViewport = getImageViewport(
    activeScene,
    activeScene?.activeImageId ?? null,
  );

  return (
    <main className="controller-shell">
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-kicker">DOUBLE ÉCRAN</span>
          <span className="brand-name">Écran du MJ</span>
        </div>
        <nav className="mode-switch" aria-label="Mode de travail">
          <button
            type="button"
            className={mode === "prepare" ? "is-active" : ""}
            onClick={() => setAppMode("prepare")}
          >
            Préparation
          </button>
          <button
            type="button"
            className={mode === "live" ? "is-active" : ""}
            onClick={() => setAppMode("live")}
          >
            Direct
          </button>
          <button
            type="button"
            className={mode === "scenario" ? "is-active" : ""}
            onClick={() => setAppMode("scenario")}
          >
            Scénario
          </button>
        </nav>
        <div className="header-actions">
          <span
            className={`connection-status ${playerConnected ? "is-online" : ""}`}
          >
            <span className="live-dot" />
            {playerConnected ? "Écran connecté" : "Écran hors ligne"}
          </span>
          <button type="button" className="primary-button" onClick={openPlayerWindow}>
            Ouvrir l’écran joueurs
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice notice-${notice.tone}`} role="status">
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      <div
        className={`workspace ${mode === "scenario" ? "scenario-mode" : ""}`}
      >
        {mode === "scenario" ? (
          <ScenarioWorkspace
            scene={activeScene}
            scenes={scenes}
            activeSceneId={activeSceneId}
            editorVisible={scenarioEditorVisible}
            onSceneChange={changeActiveScene}
            onEditorVisibleChange={setScenarioEditorVisible}
            onMarkdownChange={(scenarioMarkdown) =>
              updateActiveScene((scene) => ({ ...scene, scenarioMarkdown }))
            }
          />
        ) : (
          <>
            <aside className="control-panel">
          <div className="panel-scroll">
            <section className="control-section scene-section">
              <div className="section-heading">
                <div>
                  <span className="section-eyebrow">SCÈNE ACTIVE</span>
                  <h2>{activeScene?.name ?? "Sans titre"}</h2>
                </div>
                <span className="scene-count">{scenes.length}</span>
              </div>
              <select
                aria-label="Choisir une scène"
                value={activeSceneId}
                onChange={(event) => changeActiveScene(event.target.value)}
              >
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                  </option>
                ))}
              </select>
            </section>

            {mode === "prepare" ? (
              <>
                <section className="control-section">
                  <div className="section-title-row">
                    <h3>Bibliothèque</h3>
                    <span>Structure de la partie</span>
                  </div>
                  <label className="field-label" htmlFor="scene-name">
                    Nom de la scène
                  </label>
                  <input
                    id="scene-name"
                    type="text"
                    value={activeScene?.name ?? ""}
                    maxLength={80}
                    onChange={(event) =>
                      updateActiveScene((scene) => ({
                        ...scene,
                        name: event.target.value || "Scène sans titre",
                      }))
                    }
                  />
                  <div className="button-grid">
                    <button type="button" onClick={() => void addScene()}>
                      Nouvelle
                    </button>
                    <button
                      type="button"
                      onClick={() => void duplicateActiveScene()}
                    >
                      Dupliquer
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={scenes.length <= 1}
                      onClick={() => void deleteActiveScene()}
                    >
                      Supprimer
                    </button>
                  </div>
                </section>

                <section className="control-section">
                  <div className="section-title-row">
                    <h3>Carte</h3>
                    <span>PNG, JPEG ou WebP</span>
                  </div>
                  <label className="upload-button">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void importMap(event)}
                    />
                    {activeScene?.mapAssetId ? "Remplacer la carte" : "Importer une carte"}
                  </label>
                </section>

                <section className="control-section">
                  <div className="section-title-row">
                    <h3>Zones préparées</h3>
                    <span>{activeScene?.zones.length ?? 0} zone(s)</span>
                  </div>
                  <div className="tool-row">
                    <button
                      type="button"
                      className={tool === "rect" ? "is-selected" : ""}
                      onClick={() => {
                        setTool("rect");
                        setPolygonDraft([]);
                        setEditingZoneId(null);
                      }}
                    >
                      Rectangle
                    </button>
                    <button
                      type="button"
                      className={
                        tool === "polygon" || tool === "vertices"
                          ? "is-selected"
                          : ""
                      }
                      onClick={() => {
                        setTool("polygon");
                        setEditingZoneId(null);
                      }}
                    >
                      Polygone
                    </button>
                  </div>
                  {tool === "polygon" && (
                    <div className="polygon-actions">
                      <span>{polygonDraft.length} point(s)</span>
                      <button
                        type="button"
                        disabled={polygonDraft.length < 3}
                        onClick={finishPolygon}
                      >
                        Terminer
                      </button>
                      <button type="button" onClick={() => setPolygonDraft([])}>
                        Annuler
                      </button>
                    </div>
                  )}
                  <p className="helper-copy">
                    {tool === "rect"
                      ? "Glissez sur la carte pour créer une zone."
                      : tool === "vertices"
                        ? "Glissez les sommets dorés pour ajuster le polygone."
                        : "Cliquez les angles, puis terminez le polygone."}
                  </p>
                  {(tool === "rect" || tool === "polygon") && (
                    <p className="snap-helper">
                      <strong>Accrochage auto</strong>
                      {tool === "polygon"
                        ? "Les contours adjacents fusionnent dès le tracé."
                        : "Les points proches d’une zone se calent sur son contour."}
                    </p>
                  )}
                  <div className="zone-list compact-list">
                    {activeScene?.zones.map((zone) => (
                      <div
                        className={`zone-edit-row ${editingZoneId === zone.id ? "is-editing" : ""}`}
                        key={zone.id}
                      >
                        <input
                          aria-label={`Nom de ${zone.name}`}
                          value={zone.name}
                          maxLength={50}
                          onChange={(event) =>
                            updateActiveScene((scene) => ({
                              ...scene,
                              zones: scene.zones.map((item) =>
                                item.id === zone.id
                                  ? { ...item, name: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                        />
                        {zone.kind === "polygon" && (
                          <button
                            type="button"
                            className="vertex-edit-button"
                            aria-pressed={editingZoneId === zone.id}
                            onClick={() => {
                              const isCurrent = editingZoneId === zone.id;
                              setEditingZoneId(isCurrent ? null : zone.id);
                              setTool(isCurrent ? "polygon" : "vertices");
                              setPolygonDraft([]);
                            }}
                          >
                            {editingZoneId === zone.id ? "Terminer" : "Sommets"}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Supprimer ${zone.name}`}
                          onClick={() => {
                            if (editingZoneId === zone.id) {
                              setEditingZoneId(null);
                              setTool("polygon");
                            }
                            updateActiveScene((scene) => ({
                              ...scene,
                              zones: scene.zones.filter(
                                (item) => item.id !== zone.id,
                              ),
                            }));
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {!activeScene?.zones.length && (
                      <p className="empty-copy">Aucune zone préparée.</p>
                    )}
                  </div>
                </section>

                <section className="control-section">
                  <div className="section-title-row">
                    <h3>Galerie</h3>
                    <span>{activeScene?.galleryAssetIds.length ?? 0} image(s)</span>
                  </div>
                  <label className="upload-button">
                    <input
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void importGallery(event)}
                    />
                    Ajouter des illustrations
                  </label>
                  <GalleryGrid
                    scene={activeScene}
                    assetUrls={assetUrls}
                    editing
                    onSelect={(id) =>
                      updateActiveScene((scene) => ({
                        ...scene,
                        activeImageId: id,
                      }))
                    }
                    onRemove={(id) =>
                      updateActiveScene((scene) => {
                        const imageViewports = { ...scene.imageViewports };
                        delete imageViewports[id];
                        return {
                          ...scene,
                          galleryAssetIds: scene.galleryAssetIds.filter(
                            (assetId) => assetId !== id,
                          ),
                          activeImageId:
                            scene.activeImageId === id
                              ? null
                              : scene.activeImageId,
                          imageViewports,
                        };
                      })
                    }
                  />
                </section>

                <section className="control-section backup-section">
                  <div className="section-title-row">
                    <h3>Sauvegarde</h3>
                    <span>Fichier local</span>
                  </div>
                  <div className="button-grid">
                    <button type="button" onClick={() => void exportAll()}>
                      Exporter tout
                    </button>
                    <label className="button-label">
                      <input
                        type="file"
                        accept=".mjscreen,application/json"
                        onChange={(event) => void importAll(event)}
                      />
                      Importer
                    </label>
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="control-section">
                  <div className="section-title-row">
                    <h3>Brouillard</h3>
                    <span>Pilotage en direct</span>
                  </div>
                  <div className="tool-row">
                    <button
                      type="button"
                      className={tool === "pan" ? "is-selected" : ""}
                      onClick={() => setTool("pan")}
                    >
                      Déplacer
                    </button>
                    <button
                      type="button"
                      className={tool === "erase" ? "is-selected" : ""}
                      onClick={() => setTool("erase")}
                    >
                      Gomme libre
                    </button>
                  </div>
                  {tool === "erase" && (
                    <label className="range-field">
                      <span>
                        Taille de la gomme <strong>{brushSize}%</strong>
                      </span>
                      <input
                        type="range"
                        min="2"
                        max="12"
                        value={brushSize}
                        onChange={(event) =>
                          setBrushSize(Number(event.target.value))
                        }
                      />
                    </label>
                  )}
                  <div className="zone-list">
                    <button
                      type="button"
                      className={`zone-live-row ${activeScene?.outsideRevealed ? "is-revealed" : ""}`}
                      onClick={toggleOutside}
                    >
                      <span>Hors zones</span>
                      <strong>
                        {activeScene?.outsideRevealed ? "Visible" : "Masqué"}
                      </strong>
                    </button>
                    {activeScene?.zones.map((zone) => (
                      <button
                        type="button"
                        key={zone.id}
                        className={`zone-live-row ${zone.revealed ? "is-revealed" : ""}`}
                        onClick={() => toggleZone(zone.id)}
                      >
                        <span>{zone.name}</span>
                        <strong>{zone.revealed ? "Visible" : "Masquée"}</strong>
                      </button>
                    ))}
                    {!activeScene?.zones.length && (
                      <p className="empty-copy">
                        Aucune zone préparée : le fond représente toute la carte.
                      </p>
                    )}
                  </div>
                  <div className="button-grid">
                    <button
                      type="button"
                      disabled={!currentHistory.length}
                      onClick={undoFog}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={resetFog}
                    >
                      Tout recouvrir
                    </button>
                  </div>
                </section>

                <section className="control-section">
                  <div className="section-title-row">
                    <h3>Illustration</h3>
                    <button
                      type="button"
                      className={`small-toggle ${activeScene?.panelVisible ? "is-on" : ""}`}
                      onClick={() =>
                        updateActiveScene((scene) => {
                          const panelVisible = !scene.panelVisible;
                          return {
                            ...scene,
                            panelVisible,
                            panelWidth:
                              panelVisible &&
                              scene.panelWidth === PANEL_WIDTH_MIN
                                ? DEFAULT_PANEL_WIDTH
                                : scene.panelWidth,
                          };
                        })
                      }
                    >
                      {activeScene?.panelVisible ? "Panneau visible" : "Panneau masqué"}
                    </button>
                  </div>
                  <GalleryGrid
                    scene={activeScene}
                    assetUrls={assetUrls}
                    onSelect={(id) =>
                      updateActiveScene((scene) => ({
                        ...scene,
                        activeImageId: id,
                      }))
                    }
                  />
                </section>

                <section className="control-section">
                  <div className="section-title-row">
                    <h3>Composition</h3>
                    <span>Vue joueurs</span>
                  </div>
                  <label className="range-field">
                    <span>
                      Répartition{" "}
                      <strong>
                        {effectiveMapWidth}% carte · {effectivePanelWidth}% image
                      </strong>
                    </span>
                    <input
                      type="range"
                      min={PANEL_WIDTH_MIN}
                      max={PANEL_WIDTH_MAX}
                      aria-label="Répartition entre la carte et l’image"
                      value={effectivePanelWidth}
                      onChange={(event) => {
                        const panelWidth = clampPanelWidth(
                          Number(event.target.value),
                        );
                        updateActiveScene((scene) => ({
                          ...scene,
                          panelWidth,
                          panelVisible: panelWidth > PANEL_WIDTH_MIN,
                        }));
                      }}
                    />
                  </label>
                  <label className="range-field">
                    <span>
                      Zoom carte{" "}
                      <strong>
                        {Math.round((activeScene?.viewport.zoom ?? 1) * 100)}%
                      </strong>
                    </span>
                    <input
                      type="range"
                      min="75"
                      max="400"
                      value={Math.round(
                        (activeScene?.viewport.zoom ?? 1) * 100,
                      )}
                      onChange={(event) =>
                        updateActiveScene((scene) => ({
                          ...scene,
                          viewport: {
                            ...scene.viewport,
                            zoom: Number(event.target.value) / 100,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="range-field">
                    <span>
                      Zoom image{" "}
                      <strong>
                        {Math.round(activeImageViewport.zoom * 100)}%
                      </strong>
                    </span>
                    <input
                      type="range"
                      min="75"
                      max="400"
                      disabled={!activeScene?.activeImageId}
                      value={Math.round(activeImageViewport.zoom * 100)}
                      onChange={(event) => {
                        const zoom = Number(event.target.value) / 100;
                        updateActiveScene((scene) => {
                          const imageId = scene.activeImageId;
                          if (!imageId) return scene;
                          return {
                            ...scene,
                            imageViewports: {
                              ...scene.imageViewports,
                              [imageId]: {
                                ...getImageViewport(scene, imageId),
                                zoom,
                              },
                            },
                          };
                        });
                      }}
                    />
                  </label>
                  <div className="button-grid">
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveScene((scene) => ({
                          ...scene,
                          viewport: { zoom: 1, x: 0, y: 0 },
                        }))
                      }
                    >
                      Recentrer la carte
                    </button>
                    <button
                      type="button"
                      disabled={!activeScene?.activeImageId}
                      onClick={() =>
                        updateActiveScene((scene) => {
                          const imageId = scene.activeImageId;
                          if (!imageId) return scene;
                          return {
                            ...scene,
                            imageViewports: {
                              ...scene.imageViewports,
                              [imageId]: { zoom: 1, x: 0, y: 0 },
                            },
                          };
                        })
                      }
                    >
                      Recentrer l’image
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
        </aside>

        <section className="preview-area">
          <div className="preview-heading">
            <div>
              <span className="section-eyebrow">APERÇU JOUEURS</span>
              <h1>{activeScene?.name}</h1>
            </div>
            <div className="preview-hints">
              <span>
                {mode === "prepare"
                  ? "Les repères de zones ne sont visibles qu’ici."
                  : tool === "erase"
                    ? "Glissez sur la carte pour révéler."
                    : "Cliquez une zone ou le fond pour l’afficher ; glissez la carte ou l’image pour cadrer."}
              </span>
              <span className="autosave-label">Enregistrement automatique</span>
            </div>
          </div>
          <div className="preview-bezel">
            <PlayerFrame
              scene={activeScene}
              assetUrls={assetUrls}
              className="controller-preview"
              interactive
              mode={mode}
              tool={tool}
              brushSize={brushSize}
              polygonDraft={polygonDraft}
              editingZoneId={editingZoneId}
              onPolygonDraftChange={setPolygonDraft}
              onCreateZone={addZone}
              onMoveZoneVertex={moveZoneVertex}
              onStroke={addStroke}
              onToggleZone={toggleZone}
              onToggleOutside={toggleOutside}
              onViewportChange={(viewport) =>
                updateActiveScene((scene) => ({ ...scene, viewport }))
              }
              onImageViewportChange={(viewport) =>
                updateActiveScene((scene) => {
                  const imageId = scene.activeImageId;
                  if (!imageId) return scene;
                  return {
                    ...scene,
                    imageViewports: {
                      ...scene.imageViewports,
                      [imageId]: viewport,
                    },
                  };
                })
              }
            />
          </div>
          <div className="preview-footer">
            <span>16:9 adaptatif</span>
            <span>
              {activeScene?.mapAssetId
                ? "Carte prête"
                : "Importez une carte pour commencer"}
            </span>
          </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function GalleryGrid({
  scene,
  assetUrls,
  editing = false,
  onSelect,
  onRemove,
}: {
  scene: Scene | null;
  assetUrls: Map<string, string>;
  editing?: boolean;
  onSelect: (id: string | null) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <div className="gallery-grid">
      <button
        type="button"
        className={`gallery-tile gallery-none ${!scene?.activeImageId ? "is-active" : ""}`}
        onClick={() => onSelect(null)}
      >
        <span aria-hidden="true">—</span>
        <small>Aucune</small>
      </button>
      {scene?.galleryAssetIds.map((assetId, index) => {
        const url = assetUrls.get(assetId);
        return (
          <div
            className={`gallery-tile ${scene.activeImageId === assetId ? "is-active" : ""}`}
            key={assetId}
          >
            <button
              type="button"
              className="gallery-select"
              onClick={() => onSelect(assetId)}
              aria-label={`Afficher l’illustration ${index + 1}`}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" />
              ) : (
                <span className="image-loading">…</span>
              )}
            </button>
            {editing && onRemove && (
              <button
                type="button"
                className="gallery-remove"
                aria-label={`Retirer l’illustration ${index + 1}`}
                onClick={() => onRemove(assetId)}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MjScreenApp() {
  const [isPlayer, setIsPlayer] = useState(false);
  useEffect(() => {
    setIsPlayer(
      new URLSearchParams(window.location.search).get("view") === "player",
    );
  }, []);
  return isPlayer ? <PlayerView /> : <ControllerView />;
}
