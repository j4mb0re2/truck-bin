"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleParking,
  Clock3,
  Coffee,
  Database,
  Download,
  ExternalLink,
  Fuel,
  FileJson,
  GripVertical,
  Map,
  MapPin,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Satellite,
  Trash2,
  Truck,
  Upload,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GpsTrackingView } from "./gps-tracking-view";
import type { GpxCoordinate, GpxRouteData, GpxWaypoint } from "../lib/gpx-route";
import {
  isRouteSegmentColor,
  isRouteSegmentDepartureTime
} from "../lib/route-segment-utils";
import type {
  RouteSegmentColors,
  RouteSegmentDetail,
  RouteSegmentDetails,
  RouteSegmentEndpoints,
  SegmentEndpointSide
} from "../lib/route-segment-utils";

type StopType = "stage" | "taiki" | "lunch";
type StageOperation = "loading" | "unloading";

type RouteStop = {
  id: string;
  type: StopType;
  label: string;
  stageNumber?: string;
  stageOperation?: StageOperation;
  start: string;
  end: string;
};

type FuelStop = {
  locationUrl: string;
};

type FixedPoints = {
  departurePointUrl: string;
  arrivalPointUrl: string;
};

type TruckRoute = {
  id: string;
  name: string;
  departure: string;
  arrivalForecast: string;
  fuelStop?: FuelStop;
  stops: RouteStop[];
  manualPath?: GpxCoordinate[];
  manualPathColor?: string;
};

type RouteStatus = "active" | "waiting" | "done";
type GpsPointConfig = {
  startTime: string;
  arrivalTime: string;
  stops: RouteStop[];
};
type GpsPointConfigs = Record<string, GpsPointConfig>;
type GpsPointDraft = GpsPointConfig & {
  point: GpxWaypoint;
};
type GpsPointCatalog = {
  pointOrder: string[];
  removedPointIds: string[];
  pointNames: Record<string, string>;
  manualPoints: GpxWaypoint[];
  pointCoordinates: Record<string, GpxCoordinate>;
  segmentColors: RouteSegmentColors;
  segmentDetails: RouteSegmentDetails;
  segmentEndpoints: RouteSegmentEndpoints;
};
type GpsPointSourceCatalog = Pick<
  GpsPointCatalog,
  "manualPoints" | "pointCoordinates" | "pointNames" | "pointOrder" | "removedPointIds"
>;
type ResolvedGpsPoint = GpxWaypoint & {
  source: "gpx" | "manual";
};
type GpsPointEditDraft = {
  point: ResolvedGpsPoint;
  position: number;
  isNew: boolean;
  endpointAssignment?: {
    segmentIndex: number;
    side: SegmentEndpointSide;
  };
};
type GpsPointDragState = {
  activeId: string;
  overId: string;
};
type GpsPointDragSession = {
  pointerId: number;
  activeId: string;
  originX: number;
  originY: number;
  active: boolean;
  overId: string;
};

const STORAGE_KEY = "roteiro-truck-routes-v1";
const FIXED_POINTS_KEY = "roteiro-truck-fixed-points-v1";
const GPS_POINT_CONFIGS_KEY = "roteiro-truck-gps-point-configs-v1";
const GPS_POINTS_KEY = "roteiro-truck-gps-points-v1";
const BACKUP_VERSION = 10;
const EMPTY_GPS_POINT_CATALOG: GpsPointCatalog = {
  pointOrder: [],
  removedPointIds: [],
  pointNames: {},
  manualPoints: [],
  pointCoordinates: {},
  segmentColors: {},
  segmentDetails: {},
  segmentEndpoints: {}
};

type BackupMessage = {
  type: "success" | "error";
  text: string;
};

const emptyRoute = (): TruckRoute => ({
  id: "",
  name: "",
  departure: "07:00",
  arrivalForecast: "08:00",
  stops: [
    {
      id: cryptoId(),
      type: "stage",
      label: "Descarga",
      stageNumber: "",
      stageOperation: "unloading",
      start: "08:00",
      end: "09:00"
    }
  ]
});

function cryptoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isValidGpsCoordinate(value: unknown): value is GpxCoordinate {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<GpxCoordinate>;
  return (
    typeof point.latitude === "number" &&
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

function isValidGpsWaypoint(value: unknown): value is GpxWaypoint {
  if (!value || typeof value !== "object" || !isValidGpsCoordinate(value)) return false;
  const point = value as Partial<GpxWaypoint>;
  return (
    typeof point.id === "string" &&
    point.id.length > 0 &&
    typeof point.name === "string" &&
    typeof point.description === "string" &&
    typeof point.time === "string"
  );
}

function isValidStop(value: unknown): value is RouteStop {
  if (!value || typeof value !== "object") return false;
  const stop = value as Partial<RouteStop>;
  return (
    typeof stop.id === "string" &&
    (stop.type === "stage" || stop.type === "taiki" || stop.type === "lunch") &&
    typeof stop.label === "string" &&
    typeof stop.start === "string" &&
    typeof stop.end === "string" &&
    (stop.stageNumber === undefined || typeof stop.stageNumber === "string") &&
    (stop.stageOperation === undefined ||
      stop.stageOperation === "loading" ||
      stop.stageOperation === "unloading")
  );
}

function isValidManualPath(value: unknown): value is GpxCoordinate[] {
  return Array.isArray(value) && value.length >= 2 && value.every(isValidGpsCoordinate);
}

function isValidRoute(value: unknown): value is TruckRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Partial<TruckRoute>;
  return (
    typeof route.id === "string" &&
    typeof route.name === "string" &&
    typeof route.departure === "string" &&
    typeof route.arrivalForecast === "string" &&
    (route.fuelStop === undefined ||
      (typeof route.fuelStop === "object" &&
        route.fuelStop !== null &&
        typeof route.fuelStop.locationUrl === "string")) &&
    (route.manualPath === undefined || isValidManualPath(route.manualPath)) &&
    (route.manualPathColor === undefined || isRouteSegmentColor(route.manualPathColor)) &&
    Array.isArray(route.stops) &&
    route.stops.every(isValidStop)
  );
}

function migrateRoute(value: unknown): TruckRoute | null {
  if (isValidRoute(value)) return value;
  if (!value || typeof value !== "object") return null;

  const legacy = value as Partial<TruckRoute> & {
    destination?: unknown;
    locationUrl?: unknown;
    departurePointUrl?: unknown;
    arrivalPointUrl?: unknown;
    manualPath?: unknown;
  };
  if (
    typeof legacy.id !== "string" ||
    typeof legacy.name !== "string" ||
    typeof legacy.departure !== "string" ||
    !Array.isArray(legacy.stops) ||
    !legacy.stops.every(isValidStop)
  ) {
    return null;
  }

  return {
    id: legacy.id,
    name: legacy.name,
    departure: legacy.departure,
    arrivalForecast:
      typeof legacy.arrivalForecast === "string"
        ? legacy.arrivalForecast
        : legacy.departure,
    fuelStop: legacy.fuelStop,
    stops: legacy.stops,
    manualPath: isValidManualPath(legacy.manualPath)
      ? legacy.manualPath.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude
      }))
      : undefined,
    manualPathColor: isRouteSegmentColor(legacy.manualPathColor)
      ? legacy.manualPathColor
      : undefined
  };
}

function isValidFixedPoints(value: unknown): value is FixedPoints {
  if (!value || typeof value !== "object") return false;
  const points = value as Partial<FixedPoints>;
  return (
    typeof points.departurePointUrl === "string" &&
    typeof points.arrivalPointUrl === "string"
  );
}

function getLegacyFixedPoints(value: unknown): FixedPoints {
  if (!Array.isArray(value)) return { departurePointUrl: "", arrivalPointUrl: "" };
  const first = value[0] as { departurePointUrl?: unknown; arrivalPointUrl?: unknown } | undefined;
  return {
    departurePointUrl: typeof first?.departurePointUrl === "string" ? first.departurePointUrl : "",
    arrivalPointUrl: typeof first?.arrivalPointUrl === "string" ? first.arrivalPointUrl : ""
  };
}

function normalizeRoutes(value: unknown): TruckRoute[] | null {
  if (!Array.isArray(value)) return null;
  const routes = value.map(migrateRoute);
  return routes.every((route): route is TruckRoute => route !== null)
    ? routes
    : null;
}

function normalizeGpsPointConfigs(value: unknown): GpsPointConfigs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce<GpsPointConfigs>((configs, [pointId, config]) => {
    if (Array.isArray(config) && config.every(isValidStop)) {
      configs[pointId] = {
        startTime: "",
        arrivalTime: "",
        stops: config.map((stop) => ({ ...stop }))
      };
      return configs;
    }

    if (
      config &&
      typeof config === "object" &&
      !Array.isArray(config) &&
      ((config as Partial<GpsPointConfig>).startTime === undefined ||
        typeof (config as Partial<GpsPointConfig>).startTime === "string") &&
      ((config as Partial<GpsPointConfig>).arrivalTime === undefined ||
        typeof (config as Partial<GpsPointConfig>).arrivalTime === "string") &&
      Array.isArray((config as Partial<GpsPointConfig>).stops) &&
      (config as Partial<GpsPointConfig>).stops?.every(isValidStop)
    ) {
      const saved = config as Partial<GpsPointConfig>;
      configs[pointId] = {
        startTime: saved.startTime ?? "",
        arrivalTime: saved.arrivalTime ?? "",
        stops: saved.stops?.map((stop) => ({ ...stop })) ?? []
      };
    }
    return configs;
  }, {});
}

function normalizeGpsPointCatalog(value: unknown): GpsPointCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_GPS_POINT_CATALOG;
  }

  const catalog = value as Partial<GpsPointCatalog>;
  const seenManualIds = new Set<string>();
  const manualPoints = Array.isArray(catalog.manualPoints)
    ? catalog.manualPoints.filter((point) => {
      if (!isValidGpsWaypoint(point) || seenManualIds.has(point.id)) return false;
      seenManualIds.add(point.id);
      return true;
    }).map((point) => ({ ...point }))
    : [];

  const seenRemovedIds = new Set<string>();
  const removedPointIds = Array.isArray(catalog.removedPointIds)
    ? catalog.removedPointIds.filter((id): id is string => {
      if (typeof id !== "string" || !id || seenRemovedIds.has(id)) return false;
      seenRemovedIds.add(id);
      return true;
    })
    : [];

  const pointNames =
    catalog.pointNames &&
    typeof catalog.pointNames === "object" &&
    !Array.isArray(catalog.pointNames)
      ? Object.entries(catalog.pointNames).reduce<Record<string, string>>((names, [id, name]) => {
        if (typeof name === "string") names[id] = name;
        return names;
      }, {})
      : {};

  const pointCoordinates =
    catalog.pointCoordinates &&
    typeof catalog.pointCoordinates === "object" &&
    !Array.isArray(catalog.pointCoordinates)
      ? Object.entries(catalog.pointCoordinates).reduce<Record<string, GpxCoordinate>>(
        (coordinates, [pointId, coordinate]) => {
          if (pointId && isValidGpsCoordinate(coordinate)) {
            coordinates[pointId] = {
              latitude: coordinate.latitude,
              longitude: coordinate.longitude
            };
          }
          return coordinates;
        },
        {}
      )
      : {};

  const segmentColors =
    catalog.segmentColors &&
    typeof catalog.segmentColors === "object" &&
    !Array.isArray(catalog.segmentColors)
      ? Object.entries(catalog.segmentColors).reduce<RouteSegmentColors>(
        (colors, [segmentIndex, color]) => {
          const index = Number(segmentIndex);
          if (Number.isInteger(index) && index >= 0 && isRouteSegmentColor(color)) {
            colors[index] = color;
          }
          return colors;
        },
        {}
      )
      : {};

  const segmentDetails =
    catalog.segmentDetails &&
    typeof catalog.segmentDetails === "object" &&
    !Array.isArray(catalog.segmentDetails)
      ? Object.entries(catalog.segmentDetails).reduce<RouteSegmentDetails>(
        (details, [segmentIndex, detail]) => {
          const index = Number(segmentIndex);
          if (!Number.isInteger(index) || index < 0 || !detail || typeof detail !== "object") {
            return details;
          }

          const saved = detail as Partial<RouteSegmentDetail>;
          const name = typeof saved.name === "string" ? saved.name.trim() : "";
          const departureTime = isRouteSegmentDepartureTime(saved.departureTime)
            ? saved.departureTime
            : "";
          const arrivalTime = isRouteSegmentDepartureTime(saved.arrivalTime)
            ? saved.arrivalTime
            : "";
          if (name || departureTime || arrivalTime) {
            details[index] = { name, departureTime, arrivalTime };
          }
          return details;
        },
        {}
      )
      : {};

  const segmentEndpoints =
    catalog.segmentEndpoints &&
    typeof catalog.segmentEndpoints === "object" &&
    !Array.isArray(catalog.segmentEndpoints)
      ? Object.entries(catalog.segmentEndpoints).reduce<RouteSegmentEndpoints>(
        (endpoints, [segmentIndex, endpoint]) => {
          const index = Number(segmentIndex);
          if (!Number.isInteger(index) || index < 0 || !endpoint || typeof endpoint !== "object") {
            return endpoints;
          }

          const saved = endpoint as { startPointId?: unknown; endPointId?: unknown };
          const startPointId =
            typeof saved.startPointId === "string" && saved.startPointId ? saved.startPointId : undefined;
          const endPointId =
            typeof saved.endPointId === "string" && saved.endPointId ? saved.endPointId : undefined;
          if (startPointId || endPointId) endpoints[index] = { startPointId, endPointId };
          return endpoints;
        },
        {}
      )
      : {};

  const seenOrderIds = new Set<string>();
  const pointOrder = Array.isArray(catalog.pointOrder)
    ? catalog.pointOrder.filter((id): id is string => {
      if (typeof id !== "string" || seenOrderIds.has(id)) return false;
      seenOrderIds.add(id);
      return true;
    })
    : [];

  return {
    manualPoints,
    removedPointIds,
    pointNames,
    pointCoordinates,
    pointOrder,
    segmentColors,
    segmentDetails,
    segmentEndpoints
  };
}

function getGpsPointOrder(gpxPoints: GpxWaypoint[], catalog: GpsPointSourceCatalog) {
  const removedPointIdSet = new Set(catalog.removedPointIds);
  const knownIds = Array.from(
    new Set([
      ...gpxPoints.map((point) => point.id),
      ...catalog.manualPoints.map((point) => point.id)
    ])
  ).filter((id) => !removedPointIdSet.has(id));
  const knownIdSet = new Set(knownIds);
  const savedOrder = catalog.pointOrder.filter((id) => knownIdSet.has(id));
  const orderedIdSet = new Set(savedOrder);

  return [...savedOrder, ...knownIds.filter((id) => !orderedIdSet.has(id))];
}

function resolveGpsPoints(
  gpxPoints: GpxWaypoint[],
  catalog: GpsPointSourceCatalog
): ResolvedGpsPoint[] {
  const removedPointIdSet = new Set(catalog.removedPointIds);
  const points = [
    ...gpxPoints.filter((point) => !removedPointIdSet.has(point.id)).map((point) => ({
      ...point,
      latitude: catalog.pointCoordinates[point.id]?.latitude ?? point.latitude,
      longitude: catalog.pointCoordinates[point.id]?.longitude ?? point.longitude,
      name: catalog.pointNames[point.id]?.trim() || point.name,
      source: "gpx" as const
    })),
    ...catalog.manualPoints.filter((point) => !removedPointIdSet.has(point.id)).map((point) => ({
      ...point,
      latitude: catalog.pointCoordinates[point.id]?.latitude ?? point.latitude,
      longitude: catalog.pointCoordinates[point.id]?.longitude ?? point.longitude,
      name: catalog.pointNames[point.id]?.trim() || point.name,
      source: "manual" as const
    }))
  ];
  const pointsById = new globalThis.Map<string, ResolvedGpsPoint>(
    points.map((point) => [point.id, point])
  );
  return getGpsPointOrder(gpxPoints, catalog)
    .map((id) => pointsById.get(id))
    .filter((point): point is ResolvedGpsPoint => Boolean(point));
}

function localISODate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000)
    .toISOString()
    .slice(0, 10);
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function routeEnd(route: TruckRoute) {
  return Math.max(
    toMinutes(route.departure),
    toMinutes(route.arrivalForecast),
    ...route.stops.map((stop) => toMinutes(stop.end))
  );
}

function getStatus(route: TruckRoute, nowMinutes: number): RouteStatus {
  if (nowMinutes < toMinutes(route.departure)) return "waiting";
  if (nowMinutes >= routeEnd(route)) return "done";
  return "active";
}

function getProgress(route: TruckRoute, nowMinutes: number) {
  const start = toMinutes(route.departure);
  const end = routeEnd(route);
  if (nowMinutes >= end) return 100;
  if (nowMinutes <= start) return 0;
  return Math.min(100, Math.round(((nowMinutes - start) / (end - start)) * 100));
}

function minutesToTime(minutes: number) {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function makeDemoRoutes(currentMinutes: number): TruckRoute[] {
  const base = Math.max(5 * 60, Math.min(20 * 60, currentMinutes));
  const time = (offset: number) => minutesToTime(base + offset);

  return [
    {
      id: "demo-toyota",
      name: "Toyota Motomachi",
      departure: time(-240),
      arrivalForecast: time(-175),
      stops: [
        {
          id: "demo-taiki-1",
          type: "taiki",
          label: "Taiki Portão Sul",
          start: time(-200),
          end: time(-175)
        },
        {
          id: "demo-stage-1",
          type: "stage",
          label: "Entrega de peças",
          stageNumber: "05",
          stageOperation: "unloading",
          start: time(-170),
          end: time(-120)
        },
        {
          id: "demo-lunch-1",
          type: "lunch",
          label: "Almoço",
          start: time(-115),
          end: time(-85)
        },
        {
          id: "demo-stage-2",
          type: "stage",
          label: "Coleta de retorno",
          stageNumber: "12",
          stageOperation: "loading",
          start: time(-80),
          end: time(-45)
        }
      ]
    },
    {
      id: "demo-denso",
      name: "Denso Anjo",
      departure: time(-70),
      arrivalForecast: time(10),
      fuelStop: {
        locationUrl: "https://www.google.com/maps/search/?api=1&query=ENEOS+Anjo"
      },
      stops: [
        {
          id: "demo-taiki-2",
          type: "taiki",
          label: "Taiki Área B",
          start: time(-20),
          end: time(10)
        },
        {
          id: "demo-stage-3",
          type: "stage",
          label: "Entrega",
          stageNumber: "03",
          stageOperation: "unloading",
          start: time(15),
          end: time(90)
        }
      ]
    },
    {
      id: "demo-aisin",
      name: "Aisin Kariya",
      departure: time(60),
      arrivalForecast: time(115),
      stops: [
        {
          id: "demo-stage-4",
          type: "stage",
          label: "Carga programada",
          stageNumber: "08",
          stageOperation: "loading",
          start: time(115),
          end: time(190)
        }
      ]
    }
  ];
}

const statusCopy: Record<RouteStatus, { label: string; className: string }> = {
  active: { label: "Em andamento", className: "status-active" },
  waiting: { label: "Aguardando", className: "status-waiting" },
  done: { label: "Concluída", className: "status-done" }
};

const stageOperationCopy: Record<StageOperation, string> = {
  loading: "Carregamento",
  unloading: "Descarregamento"
};

const stopMeta: Record<
  StopType,
  { label: string; icon: typeof MapPin; color: string }
> = {
  stage: { label: "Stage", icon: MapPin, color: "blue" },
  taiki: { label: "Taiki", icon: CircleParking, color: "orange" },
  lunch: { label: "Almoço", icon: Coffee, color: "green" }
};

function getActiveLabel(route: TruckRoute, nowMinutes: number) {
  if (getStatus(route, nowMinutes) === "waiting") {
    return `Saída às ${route.departure}`;
  }
  const current = route.stops.find(
    (stop) =>
      nowMinutes >= toMinutes(stop.start) && nowMinutes < toMinutes(stop.end)
  );
  if (current) {
    if (current.type === "taiki") return `Em taiki até ${current.end}`;
    if (current.type === "lunch") return `Almoço até ${current.end}`;
    return `${stageOperationCopy[current.stageOperation ?? "unloading"]} no Stage ${current.stageNumber || "—"} até ${current.end}`;
  }
  if (getStatus(route, nowMinutes) === "done") return "Rota finalizada";
  const next = route.stops.find((stop) => nowMinutes < toMinutes(stop.start));
  return next ? `Próximo: ${stopMeta[next.type].label} às ${next.start}` : "Em rota";
}

function waypointTimeLabel(time: string, description: string) {
  const descriptionTime = description.match(/\b(\d{2}:\d{2})(?::\d{2})?\b/)?.[1];
  return descriptionTime ?? (time ? time.slice(11, 16) : "Ponto GPS");
}

function gpsPointScheduleLabel(config: GpsPointConfig | undefined, fallback: string) {
  const labels = [
    config?.startTime ? `Início ${config.startTime}` : "",
    config?.arrivalTime ? `Chegada ${config.arrivalTime}` : ""
  ].filter(Boolean);

  return labels.join(" · ") || fallback;
}

export function RouteDashboard({ gpxRoute }: { gpxRoute: GpxRouteData }) {
  const [routes, setRoutes] = useState<TruckRoute[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [nowMinutes, setNowMinutes] = useState(0);
  const [ready, setReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<TruckRoute | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [fixedPoints, setFixedPoints] = useState<FixedPoints>({
    departurePointUrl: "",
    arrivalPointUrl: ""
  });
  const [pointsOpen, setPointsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupMessage, setBackupMessage] = useState<BackupMessage | null>(null);
  const [viewMode, setViewMode] = useState<"routes" | "gps">("routes");
  const [gpsFocusPointId, setGpsFocusPointId] = useState<string | null>(null);
  const [gpsPointConfigs, setGpsPointConfigs] = useState<GpsPointConfigs>({});
  const [gpsPointDraft, setGpsPointDraft] = useState<GpsPointDraft | null>(null);
  const [gpsPointCatalog, setGpsPointCatalog] = useState<GpsPointCatalog>(
    EMPTY_GPS_POINT_CATALOG
  );
  const [gpsPointEditDraft, setGpsPointEditDraft] = useState<GpsPointEditDraft | null>(null);
  const [gpsPointDrag, setGpsPointDrag] = useState<GpsPointDragState | null>(null);
  const gpsPointRowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const gpsPointDragSessionRef = useRef<GpsPointDragSession | null>(null);
  const gpsPointLongPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (gpsPointLongPressTimerRef.current !== null) {
        window.clearTimeout(gpsPointLongPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };

    updateClock();
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const storedPoints = window.localStorage.getItem(FIXED_POINTS_KEY);
    const storedGpsPointConfigs = window.localStorage.getItem(GPS_POINT_CONFIGS_KEY);
    const storedGpsPoints = window.localStorage.getItem(GPS_POINTS_KEY);
    const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    let initial: TruckRoute[];
    try {
      initial = stored ? normalizeRoutes(JSON.parse(stored)) ?? [] : makeDemoRoutes(currentMinutes);
    } catch {
      initial = makeDemoRoutes(currentMinutes);
    }
    let initialPoints: FixedPoints;
    try {
      initialPoints = storedPoints && isValidFixedPoints(JSON.parse(storedPoints))
        ? JSON.parse(storedPoints)
        : getLegacyFixedPoints(stored ? JSON.parse(stored) : null);
    } catch {
      initialPoints = { departurePointUrl: "", arrivalPointUrl: "" };
    }
    let initialGpsPointConfigs: GpsPointConfigs = {};
    try {
      initialGpsPointConfigs = storedGpsPointConfigs
        ? normalizeGpsPointConfigs(JSON.parse(storedGpsPointConfigs))
        : {};
    } catch {
      initialGpsPointConfigs = {};
    }
    let initialGpsPointCatalog: GpsPointCatalog = EMPTY_GPS_POINT_CATALOG;
    try {
      initialGpsPointCatalog = storedGpsPoints
        ? normalizeGpsPointCatalog(JSON.parse(storedGpsPoints))
        : EMPTY_GPS_POINT_CATALOG;
    } catch {
      initialGpsPointCatalog = EMPTY_GPS_POINT_CATALOG;
    }
    const hydrationFrame = window.requestAnimationFrame(() => {
      setRoutes(initial);
      setFixedPoints(initialPoints);
      setGpsPointConfigs(initialGpsPointConfigs);
      setGpsPointCatalog(initialGpsPointCatalog);
      setSelectedId(
        initial.find((route) => getStatus(route, currentMinutes) === "active")?.id ??
          initial[0]?.id ??
          ""
      );
      setReady(true);
    });
    const timer = window.setInterval(updateClock, 60_000);
    return () => {
      window.cancelAnimationFrame(hydrationFrame);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (ready) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
      window.localStorage.setItem(FIXED_POINTS_KEY, JSON.stringify(fixedPoints));
      window.localStorage.setItem(GPS_POINT_CONFIGS_KEY, JSON.stringify(gpsPointConfigs));
      window.localStorage.setItem(GPS_POINTS_KEY, JSON.stringify(gpsPointCatalog));
    }
  }, [fixedPoints, gpsPointCatalog, gpsPointConfigs, ready, routes]);

  const counts = useMemo(() => {
    return routes.reduce(
      (acc, route) => {
        acc[getStatus(route, nowMinutes)] += 1;
        return acc;
      },
      { active: 0, waiting: 0, done: 0 }
    );
  }, [routes, nowMinutes]);

  const filteredRoutes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return routes
      .filter(
        (route) =>
          !normalized ||
          route.name.toLocaleLowerCase("pt-BR").includes(normalized)
      )
      .sort((a, b) => a.departure.localeCompare(b.departure));
  }, [query, routes]);

  const selectedRoute =
    routes.find((route) => route.id === selectedId) ?? filteredRoutes[0];

  const gpsPointStepCounts = useMemo(
    () => Object.fromEntries(
      Object.entries(gpsPointConfigs).map(([pointId, config]) => [pointId, config.stops.length])
    ),
    [gpsPointConfigs]
  );

  const gpsPointSourceCatalog = useMemo<GpsPointSourceCatalog>(
    () => ({
      manualPoints: gpsPointCatalog.manualPoints,
      pointCoordinates: gpsPointCatalog.pointCoordinates,
      pointNames: gpsPointCatalog.pointNames,
      pointOrder: gpsPointCatalog.pointOrder,
      removedPointIds: gpsPointCatalog.removedPointIds
    }),
    [
      gpsPointCatalog.manualPoints,
      gpsPointCatalog.pointCoordinates,
      gpsPointCatalog.pointNames,
      gpsPointCatalog.pointOrder,
      gpsPointCatalog.removedPointIds
    ]
  );
  const gpsPoints = useMemo(
    () => resolveGpsPoints(gpxRoute.waypoints, gpsPointSourceCatalog),
    [gpxRoute.waypoints, gpsPointSourceCatalog]
  );

  const gpsRouteForView = useMemo(
    () => ({ ...gpxRoute, waypoints: gpsPoints }),
    [gpxRoute, gpsPoints]
  );

  const manualRoutesForMap = useMemo(
    () =>
      routes.flatMap((route) =>
        isValidManualPath(route.manualPath)
          ? [{
            id: route.id,
            name: route.name,
            departure: route.departure,
            arrivalForecast: route.arrivalForecast,
            color: route.manualPathColor,
            points: route.manualPath.map((point) => ({
              latitude: point.latitude,
              longitude: point.longitude
            }))
          }]
          : []
      ),
    [routes]
  );

  function openNewRoute() {
    setDraft(emptyRoute());
    setModalOpen(true);
  }

  function openEditRoute(route: TruckRoute) {
    setDraft(JSON.parse(JSON.stringify(route)));
    setModalOpen(true);
  }

  function openManualRouteConfig(routeId: string) {
    const route = routes.find((item) => item.id === routeId);
    if (route && isValidManualPath(route.manualPath)) openEditRoute(route);
  }

  function createManualRouteFromMap(points: GpxCoordinate[]) {
    const manualPath = points
      .filter(isValidGpsCoordinate)
      .map((point) => ({ latitude: point.latitude, longitude: point.longitude }));
    if (manualPath.length < 2) return;

    setDraft({ ...emptyRoute(), stops: [], manualPath });
    setGpsFocusPointId(null);
    setModalOpen(true);
  }

  function saveRoute(event: React.FormEvent) {
    event.preventDefault();
    if (
      !draft ||
      !draft.name.trim()
    ) return;
    const cleaned = {
      ...draft,
      id: draft.id || cryptoId(),
      name: draft.name.trim(),
      fuelStop: draft.fuelStop
        ? { locationUrl: draft.fuelStop.locationUrl.trim() }
        : undefined,
      manualPath: isValidManualPath(draft.manualPath)
        ? draft.manualPath.map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude
        }))
        : undefined,
      manualPathColor: isRouteSegmentColor(draft.manualPathColor)
        ? draft.manualPathColor
        : undefined,
      stops: draft.stops
        .map((stop) => ({
          ...stop,
          label: stop.label.trim() || stopMeta[stop.type].label,
          stageNumber: stop.stageNumber?.trim(),
          stageOperation: stop.type === "stage" ? stop.stageOperation ?? "unloading" : undefined
        }))
        .sort((a, b) => a.start.localeCompare(b.start))
    };
    setRoutes((current) => {
      const exists = current.some((route) => route.id === cleaned.id);
      return exists
        ? current.map((route) => (route.id === cleaned.id ? cleaned : route))
        : [...current, cleaned];
    });
    setSelectedId(cleaned.id);
    setModalOpen(false);
    setDraft(null);
  }

  function deleteRoute(route: TruckRoute) {
    if (!window.confirm(`Excluir a rota “${route.name}”?`)) return;
    setRoutes((current) => current.filter((item) => item.id !== route.id));
    setSelectedId("");
  }

  function addFuelStop(route: TruckRoute) {
    setDraft({ ...route, fuelStop: { locationUrl: "" } });
    setModalOpen(true);
  }

  function saveFixedPoints(points: FixedPoints) {
    setFixedPoints({
      departurePointUrl: points.departurePointUrl.trim(),
      arrivalPointUrl: points.arrivalPointUrl.trim()
    });
    setPointsOpen(false);
  }

  function openGps(pointId: string | null = null) {
    setGpsFocusPointId(pointId);
    setViewMode("gps");
    setMobileMenu(false);
  }

  function openGpsPointConfig(point: GpxWaypoint) {
    const current = gpsPointConfigs[point.id];
    setGpsPointDraft({
      point,
      startTime: current?.startTime ?? "",
      arrivalTime: current?.arrivalTime ?? "",
      stops: (current?.stops ?? []).map((stop) => ({ ...stop }))
    });
  }

  function saveGpsPointConfig(pointId: string, config: GpsPointConfig) {
    const cleanedStops = config.stops
      .map((stop) => ({
        ...stop,
        label: stop.label.trim() || stopMeta[stop.type].label,
        stageNumber: stop.stageNumber?.trim(),
        stageOperation: stop.type === "stage" ? stop.stageOperation ?? "unloading" : undefined
      }))
      .sort((first, second) => first.start.localeCompare(second.start));

    setGpsPointConfigs((current) => {
      const next = { ...current };
      if (cleanedStops.length || config.startTime || config.arrivalTime) {
        next[pointId] = {
          startTime: config.startTime,
          arrivalTime: config.arrivalTime,
          stops: cleanedStops
        };
      }
      else delete next[pointId];
      return next;
    });
    setGpsPointDraft(null);
  }

  function openGpsPointEditor(point: ResolvedGpsPoint) {
    const position = gpsPoints.findIndex((item) => item.id === point.id) + 1;
    setGpsPointEditDraft({ point, position: Math.max(position, 1), isNew: false });
  }

  function openGpsPointEditorById(pointId: string) {
    const point = gpsPoints.find((item) => item.id === pointId);
    if (point) openGpsPointEditor(point);
  }

  function addGpsPointFromMap(coordinate: GpxCoordinate) {
    const point: ResolvedGpsPoint = {
      id: `gps-manual-${cryptoId()}`,
      name: `Ponto ${gpsPoints.length + 1}`,
      description: "Ponto adicionado manualmente no mapa",
      time: "",
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      source: "manual"
    };
    setGpsPointEditDraft({ point, position: gpsPoints.length + 1, isNew: true });
  }

  function addGpsSegmentEndpointFromMap(
    segmentIndex: number,
    side: SegmentEndpointSide,
    coordinate: GpxCoordinate
  ) {
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || !isValidGpsCoordinate(coordinate)) {
      return;
    }

    const endpointLabel = side === "start" ? "Início" : "Fim";
    const point: ResolvedGpsPoint = {
      id: `gps-manual-${cryptoId()}`,
      name: `${endpointLabel} do trecho ${segmentIndex + 1}`,
      description: `${endpointLabel} definido na linha da rota`,
      time: "",
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      source: "manual"
    };
    setGpsPointEditDraft({
      point,
      position: gpsPoints.length + 1,
      isNew: true,
      endpointAssignment: { segmentIndex, side }
    });
  }

  function saveGpsPointEditor(draftToSave: GpsPointEditDraft, name: string, position: number) {
    const cleanedName = name.trim();
    if (!cleanedName) return;

    const savedPoint: GpxWaypoint = {
      id: draftToSave.point.id,
      name: cleanedName,
      description: draftToSave.point.description,
      time: draftToSave.point.time,
      latitude: draftToSave.point.latitude,
      longitude: draftToSave.point.longitude
    };

    setGpsPointCatalog((current) => {
      const manualPoints = draftToSave.isNew
        ? [...current.manualPoints, savedPoint]
        : current.manualPoints.map((point) =>
          point.id === savedPoint.id ? savedPoint : point
        );
      const pointOrder = getGpsPointOrder(gpxRoute.waypoints, {
        ...current,
        manualPoints
      }).filter((id) => id !== savedPoint.id);
      const nextPosition = Math.min(
        Math.max(Math.round(position) || 1, 1),
        pointOrder.length + 1
      );
      pointOrder.splice(nextPosition - 1, 0, savedPoint.id);
      const pointCoordinates = { ...current.pointCoordinates };
      if (draftToSave.point.source === "manual") delete pointCoordinates[savedPoint.id];
      const segmentEndpoints = { ...current.segmentEndpoints };
      const endpointAssignment = draftToSave.endpointAssignment;

      if (endpointAssignment) {
        const endpoint = { ...segmentEndpoints[endpointAssignment.segmentIndex] };
        endpoint[endpointAssignment.side === "start" ? "startPointId" : "endPointId"] = savedPoint.id;
        segmentEndpoints[endpointAssignment.segmentIndex] = endpoint;
      }

      return {
        ...current,
        manualPoints,
        removedPointIds: current.removedPointIds.filter((pointId) => pointId !== savedPoint.id),
        pointNames: { ...current.pointNames, [savedPoint.id]: cleanedName },
        pointCoordinates,
        pointOrder,
        segmentEndpoints
      };
    });
    setGpsFocusPointId(savedPoint.id);
    setGpsPointEditDraft(null);
  }

  function removeGpsPoint(point: ResolvedGpsPoint) {
    const sourceLabel = point.source === "manual" ? "ponto adicionado no mapa" : "marcador do arquivo GPX";
    if (
      !window.confirm(
        `Remover “${point.name}” (${sourceLabel}) da lista e do mapa? O traçado GPX não será alterado.`
      )
    ) {
      return;
    }

    setGpsPointCatalog((current) => {
      const manualPoints =
        point.source === "manual"
          ? current.manualPoints.filter((manualPoint) => manualPoint.id !== point.id)
          : current.manualPoints;
      const removedPointIds =
        point.source === "gpx"
          ? [...new Set([...current.removedPointIds, point.id])]
          : current.removedPointIds.filter((pointId) => pointId !== point.id);
      const pointNames = { ...current.pointNames };
      const pointCoordinates = { ...current.pointCoordinates };
      delete pointNames[point.id];
      delete pointCoordinates[point.id];
      const segmentEndpoints = Object.entries(current.segmentEndpoints).reduce<RouteSegmentEndpoints>(
        (next, [segmentIndex, savedEndpoints]) => {
          const endpoints = { ...savedEndpoints };
          if (endpoints.startPointId === point.id) delete endpoints.startPointId;
          if (endpoints.endPointId === point.id) delete endpoints.endPointId;
          if (endpoints.startPointId || endpoints.endPointId) {
            next[Number(segmentIndex)] = endpoints;
          }
          return next;
        },
        {}
      );

      return {
        ...current,
        manualPoints,
        removedPointIds,
        pointNames,
        pointCoordinates,
        pointOrder: current.pointOrder.filter((pointId) => pointId !== point.id),
        segmentEndpoints
      };
    });
    setGpsPointConfigs((current) => {
      const remainingConfigs = { ...current };
      delete remainingConfigs[point.id];
      return remainingConfigs;
    });
    setGpsFocusPointId((current) => (current === point.id ? null : current));
    setGpsPointEditDraft((current) => (current?.point.id === point.id ? null : current));
  }

  function saveGpsPointPositions(changes: Record<string, GpxCoordinate>) {
    const knownPointIds = new Set(gpsPoints.map((point) => point.id));

    setGpsPointCatalog((current) => {
      const pointCoordinates = { ...current.pointCoordinates };

      Object.entries(changes).forEach(([pointId, coordinate]) => {
        if (!knownPointIds.has(pointId) || !isValidGpsCoordinate(coordinate)) return;
        pointCoordinates[pointId] = {
          latitude: coordinate.latitude,
          longitude: coordinate.longitude
        };
      });

      return { ...current, pointCoordinates };
    });
  }

  function saveGpsSegmentColor(segmentIndex: number, color: string) {
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || !isRouteSegmentColor(color)) {
      return;
    }

    setGpsPointCatalog((current) => ({
      ...current,
      segmentColors: { ...current.segmentColors, [segmentIndex]: color }
    }));
  }

  function saveManualRouteColor(routeId: string, color: string) {
    if (!isRouteSegmentColor(color)) return;

    setRoutes((current) =>
      current.map((route) =>
        route.id === routeId && isValidManualPath(route.manualPath)
          ? { ...route, manualPathColor: color }
          : route
      )
    );
  }

  function saveGpsSegmentDetails(segmentIndex: number, details: RouteSegmentDetail) {
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) return;

    const name = details.name?.trim() ?? "";
    const departureTime = isRouteSegmentDepartureTime(details.departureTime)
      ? details.departureTime
      : "";
    const arrivalTime = isRouteSegmentDepartureTime(details.arrivalTime)
      ? details.arrivalTime
      : "";

    setGpsPointCatalog((current) => {
      const segmentDetails = { ...current.segmentDetails };
      if (name || departureTime || arrivalTime) {
        segmentDetails[segmentIndex] = { name, departureTime, arrivalTime };
      } else {
        delete segmentDetails[segmentIndex];
      }
      return { ...current, segmentDetails };
    });
  }

  function saveGpsSegmentEndpoint(
    segmentIndex: number,
    side: SegmentEndpointSide,
    pointId: string | null
  ) {
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) return;
    const knownPointIds = new Set(gpsPoints.map((point) => point.id));
    if (pointId && !knownPointIds.has(pointId)) return;

    setGpsPointCatalog((current) => {
      const segmentEndpoints = { ...current.segmentEndpoints };
      const endpoint = { ...segmentEndpoints[segmentIndex] };
      const endpointKey = side === "start" ? "startPointId" : "endPointId";

      if (pointId) endpoint[endpointKey] = pointId;
      else delete endpoint[endpointKey];

      if (endpoint.startPointId || endpoint.endPointId) {
        segmentEndpoints[segmentIndex] = endpoint;
      } else {
        delete segmentEndpoints[segmentIndex];
      }

      return { ...current, segmentEndpoints };
    });
  }

  function reorderGpsPoints(activeId: string, overId: string) {
    if (activeId === overId) return;

    setGpsPointCatalog((current) => {
      const pointOrder = getGpsPointOrder(gpxRoute.waypoints, current);
      const activeIndex = pointOrder.indexOf(activeId);
      const overIndex = pointOrder.indexOf(overId);
      if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return current;

      const movingPoint = pointOrder[activeIndex];
      if (!movingPoint) return current;
      pointOrder.splice(activeIndex, 1);
      pointOrder.splice(overIndex, 0, movingPoint);

      return { ...current, pointOrder };
    });
  }

  function clearGpsPointLongPressTimer() {
    if (gpsPointLongPressTimerRef.current !== null) {
      window.clearTimeout(gpsPointLongPressTimerRef.current);
      gpsPointLongPressTimerRef.current = null;
    }
  }

  function closestGpsPointId(clientX: number, clientY: number) {
    let closestId: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    Object.entries(gpsPointRowsRef.current).forEach(([pointId, row]) => {
      if (!row) return;
      const bounds = row.getBoundingClientRect();
      const distance = Math.hypot(
        clientX - (bounds.left + bounds.width / 2),
        clientY - (bounds.top + bounds.height / 2)
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestId = pointId;
      }
    });

    return closestId;
  }

  function activateGpsPointDrag(session: GpsPointDragSession, clientX: number, clientY: number) {
    session.active = true;
    session.overId = closestGpsPointId(clientX, clientY) ?? session.activeId;
    setGpsPointDrag({ activeId: session.activeId, overId: session.overId });
  }

  function startGpsPointDrag(event: React.PointerEvent<HTMLButtonElement>, pointId: string) {
    if (!ready || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    clearGpsPointLongPressTimer();
    const session: GpsPointDragSession = {
      pointerId: event.pointerId,
      activeId: pointId,
      originX: event.clientX,
      originY: event.clientY,
      active: false,
      overId: pointId
    };
    gpsPointDragSessionRef.current = session;
    const pointerId = event.pointerId;

    gpsPointLongPressTimerRef.current = window.setTimeout(() => {
      const activeSession = gpsPointDragSessionRef.current;
      if (!activeSession || activeSession.pointerId !== pointerId || activeSession.active) return;
      activateGpsPointDrag(activeSession, activeSession.originX, activeSession.originY);
      gpsPointLongPressTimerRef.current = null;
    }, 180);
  }

  function handleGpsPointDragMove(event: React.PointerEvent<HTMLButtonElement>) {
    const session = gpsPointDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    if (!session.active) {
      const distance = Math.hypot(event.clientX - session.originX, event.clientY - session.originY);
      if (distance < 8) return;
      clearGpsPointLongPressTimer();
      activateGpsPointDrag(session, event.clientX, event.clientY);
      return;
    }

    const overId = closestGpsPointId(event.clientX, event.clientY) ?? session.activeId;
    if (overId === session.overId) return;
    session.overId = overId;
    setGpsPointDrag({ activeId: session.activeId, overId });
  }

  function finishGpsPointDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const session = gpsPointDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    clearGpsPointLongPressTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gpsPointDragSessionRef.current = null;
    setGpsPointDrag(null);
    if (session.active && session.overId !== session.activeId) {
      reorderGpsPoints(session.activeId, session.overId);
    }
  }

  function cancelGpsPointDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const session = gpsPointDragSessionRef.current;
    if (session && session.pointerId !== event.pointerId) return;

    clearGpsPointLongPressTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gpsPointDragSessionRef.current = null;
    setGpsPointDrag(null);
  }

  function exportBackup() {
    const payload = {
      app: "Roteiro",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      fixedPoints,
      gpsPointCatalog,
      gpsPointConfigs,
      routes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `roteiro-projeto-${localISODate()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupMessage({
      type: "success",
      text: `${routes.length} ${routes.length === 1 ? "rota exportada" : "rotas exportadas"} com sucesso.`
    });
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const parsed: unknown = JSON.parse(await file.text());
      const importedRoutes = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "routes" in parsed
          ? (parsed as { routes: unknown }).routes
          : null;

      const safeRoutes = normalizeRoutes(importedRoutes);
      if (!safeRoutes) {
        throw new Error("invalid-backup");
      }

      const confirmed = window.confirm(
        `Importar ${safeRoutes.length} ${safeRoutes.length === 1 ? "rota" : "rotas"}? As rotas atuais deste navegador serão substituídas.`
      );
      if (!confirmed) return;

      const clonedRoutes = safeRoutes.map((route) => ({
        ...route,
        stops: route.stops.map((stop) => ({ ...stop }))
      }));
      setRoutes(clonedRoutes);
      const importedPoints =
        parsed && typeof parsed === "object" && "fixedPoints" in parsed &&
        isValidFixedPoints((parsed as { fixedPoints: unknown }).fixedPoints)
          ? (parsed as { fixedPoints: FixedPoints }).fixedPoints
          : getLegacyFixedPoints(importedRoutes);
      setFixedPoints(importedPoints);
      const importedGpsPointConfigs =
        parsed && typeof parsed === "object" && "gpsPointConfigs" in parsed
          ? normalizeGpsPointConfigs((parsed as { gpsPointConfigs: unknown }).gpsPointConfigs)
          : {};
      setGpsPointConfigs(importedGpsPointConfigs);
      const importedGpsPointCatalog =
        parsed && typeof parsed === "object" && "gpsPointCatalog" in parsed
          ? normalizeGpsPointCatalog((parsed as { gpsPointCatalog: unknown }).gpsPointCatalog)
          : EMPTY_GPS_POINT_CATALOG;
      setGpsPointCatalog(importedGpsPointCatalog);
      setSelectedId(clonedRoutes[0]?.id ?? "");
      setQuery("");
      setBackupMessage({
        type: "success",
        text: `Arquivo importado. ${clonedRoutes.length} ${clonedRoutes.length === 1 ? "rota foi restaurada" : "rotas foram restauradas"}.`
      });
    } catch {
      setBackupMessage({
        type: "error",
        text: "Não foi possível importar. Escolha um arquivo de backup válido do Roteiro."
      });
    }
  }

  const gpsPointsPanel = (
    <aside className="gps-points-panel panel" aria-labelledby="gps-points-title">
      <div className="gps-points-heading">
        <div className="gps-points-icon"><MapPin size={18} /></div>
        <div>
          <h2 id="gps-points-title">Pontos no mapa</h2>
          <p>{gpsPoints.length} {gpsPoints.length === 1 ? "ponto" : "pontos"} inseridos</p>
        </div>
      </div>
      <p className="gps-points-note">
        Segure ⠿ para ordenar. Remover tira apenas o marcador: o traçado GPX continua igual.
      </p>
      {gpsPoints.length ? (
        <div className="gpx-points-list gps-map-points-list" role="list">
          {gpsPoints.map((point, index) => {
            const config = gpsPointConfigs[point.id];
            const isDraggingPoint = gpsPointDrag?.activeId === point.id;
            const isDropTarget = Boolean(
              gpsPointDrag &&
              gpsPointDrag.overId === point.id &&
              gpsPointDrag.activeId !== point.id
            );
            const pointDetail = gpsPointScheduleLabel(
              config,
              waypointTimeLabel(point.time, point.description)
            );

            return (
              <div
                className={`gpx-point-row${isDraggingPoint ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}${gpsFocusPointId === point.id ? " is-focused" : ""}`}
                key={point.id}
                data-gps-point-id={point.id}
                ref={(node) => {
                  gpsPointRowsRef.current[point.id] = node;
                }}
                role="listitem"
              >
                <button
                  className="gpx-point-open"
                  type="button"
                  onClick={() => setGpsFocusPointId(point.id)}
                  aria-label={`Centralizar ${point.name} no mapa GPS`}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{point.name}</strong>
                    <small>
                      {pointDetail}
                      {point.source === "manual" ? " · adicionado no mapa" : ""}
                    </small>
                  </div>
                  <MapPin size={14} />
                </button>
                <div className="gpx-point-actions">
                  <button
                    className="gpx-point-drag-handle"
                    type="button"
                    disabled={!ready}
                    aria-label={`Segure e arraste ${point.name} para mudar a posição`}
                    title="Segure e arraste para reorganizar"
                    onPointerDown={(event) => startGpsPointDrag(event, point.id)}
                    onPointerMove={handleGpsPointDragMove}
                    onPointerUp={finishGpsPointDrag}
                    onPointerCancel={cancelGpsPointDrag}
                    onLostPointerCapture={cancelGpsPointDrag}
                    onClick={(event) => event.preventDefault()}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <GripVertical size={14} />
                  </button>
                  <button
                    className="gpx-point-edit"
                    type="button"
                    aria-label={`Editar nome e número de ${point.name}`}
                    title="Editar nome e número"
                    onClick={() => openGpsPointEditor(point)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="gpx-point-configure"
                    type="button"
                    onClick={() => openGpsPointConfig(point)}
                  >
                    <Clock3 size={12} />
                    {gpsPointStepCounts[point.id]
                      ? `${gpsPointStepCounts[point.id]} ${gpsPointStepCounts[point.id] === 1 ? "etapa" : "etapas"}`
                      : config?.startTime || config?.arrivalTime
                        ? "Editar horários"
                        : "Configurar etapas"}
                  </button>
                  <button
                    className="gpx-point-delete"
                    type="button"
                    aria-label={`Remover ${point.name} do mapa`}
                    title="Remover marcador do mapa"
                    onClick={() => removeGpsPoint(point)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="gps-points-empty">
          <MapPin size={18} />
          <span>Nenhum marcador visível. Use “Adicionar ponto” no mapa quando precisar.</span>
        </div>
      )}
    </aside>
  );

  if (viewMode === "gps") {
    return (
      <>
        <GpsTrackingView
          route={gpsRouteForView}
          pointStepCounts={gpsPointStepCounts}
          pointsPanel={gpsPointsPanel}
          segmentColors={gpsPointCatalog.segmentColors}
          segmentDetails={gpsPointCatalog.segmentDetails}
          segmentEndpoints={gpsPointCatalog.segmentEndpoints}
          manualRoutes={manualRoutesForMap}
          initialWaypointId={gpsFocusPointId}
          onAddPoint={addGpsPointFromMap}
          onEditPoint={openGpsPointEditorById}
          onSavePointPositions={saveGpsPointPositions}
          onChangeSegmentColor={saveGpsSegmentColor}
          onChangeManualRouteColor={saveManualRouteColor}
          onEditManualRoute={openManualRouteConfig}
          onSaveSegmentDetails={saveGpsSegmentDetails}
          onAssignSegmentEndpoint={saveGpsSegmentEndpoint}
          onCreateSegmentEndpoint={addGpsSegmentEndpointFromMap}
          onCreateManualRoute={createManualRouteFromMap}
          onBack={() => {
            setViewMode("routes");
            setGpsFocusPointId(null);
          }}
        />
        {modalOpen && draft && (
          <RouteModal
            draft={draft}
            setDraft={setDraft}
            onClose={() => {
              setModalOpen(false);
              setDraft(null);
            }}
            onSave={saveRoute}
          />
        )}
        {gpsPointDraft && (
          <GpsPointConfigModal
            point={gpsPointDraft.point}
            initialConfig={gpsPointDraft}
            onClose={() => setGpsPointDraft(null)}
            onSave={(config) => saveGpsPointConfig(gpsPointDraft.point.id, config)}
          />
        )}
        {gpsPointEditDraft && (
          <GpsPointEditorModal
            draft={gpsPointEditDraft}
            pointCount={gpsPoints.length + (gpsPointEditDraft.isNew ? 1 : 0)}
            onClose={() => setGpsPointEditDraft(null)}
            onSave={(name, position) => saveGpsPointEditor(gpsPointEditDraft, name, position)}
          />
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <RouteIcon size={22} strokeWidth={2.4} />
          </span>
          <span>ROTEIRO</span>
        </div>
        <button
          className="mobile-close"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMobileMenu(false)}
        >
          <X size={20} />
        </button>

        <nav className="main-nav" aria-label="Navegação principal">
          <button className="nav-item active" type="button">
            <Map size={19} />
            Minhas rotas
            <span className="nav-count">{routes.length}</span>
          </button>
          <button className="nav-item nav-gps" type="button" onClick={() => openGps()}>
            <Satellite size={19} />
            GPS
            {gpsPoints.length > 0 && <span className="nav-count">{gpsPoints.length}</span>}
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <button
          className="nav-item"
          type="button"
          onClick={() => {
            setBackupMessage(null);
            setBackupOpen(true);
            setMobileMenu(false);
          }}
        >
          <Database size={19} />
          Backup e dados
        </button>
        <div className="profile">
          <span className="avatar">MF</span>
          <div>
            <strong>Motorista</strong>
            <span>Operação Aichi</span>
          </div>
          <MoreHorizontal size={18} />
        </div>
      </aside>

      {mobileMenu && (
        <button
          className="mobile-overlay"
          aria-label="Fechar menu"
          onClick={() => setMobileMenu(false)}
        />
      )}

      <main className="main-content">
        <header className="page-header">
          <div className="header-title">
            <button
              className="menu-button"
              type="button"
              aria-label="Abrir menu"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={22} />
            </button>
            <div>
              <span className="eyebrow">PAINEL DE OPERAÇÃO</span>
              <h1>Bom dia! <span>👋</span></h1>
              <p>Acompanhe suas rotas e mantenha o dia no horário.</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="secondary-button gps-launch-button" type="button" onClick={() => openGps()}>
              <Satellite size={18} />
              GPS
            </button>
            <button
              className="secondary-button export-project-button"
              type="button"
              onClick={exportBackup}
              aria-label="Exportar dados e configurações do projeto para um arquivo JSON"
              title="Exportar projeto"
            >
              <Download size={18} />
              Exportar
            </button>
            <button className="primary-button" type="button" onClick={openNewRoute}>
              <Plus size={19} />
              Nova rota
            </button>
          </div>
        </header>

        <section className="stats-grid" aria-label="Resumo das rotas">
          <article className="stat-card stat-total">
            <div className="stat-icon"><Truck size={22} /></div>
            <div>
              <span>Rotas cadastradas</span>
              <strong>{routes.length}</strong>
            </div>
            <span className="stat-note">programadas</span>
          </article>
          <article className="stat-card stat-progress">
            <div className="stat-icon"><ArrowRight size={22} /></div>
            <div>
              <span>Em andamento</span>
              <strong>{counts.active}</strong>
            </div>
            <div className="pulse-label"><i /> ao vivo</div>
          </article>
          <article className="stat-card stat-complete">
            <div className="stat-icon"><CheckCircle2 size={22} /></div>
            <div>
              <span>Concluídas</span>
              <strong>{counts.done}</strong>
            </div>
            <span className="stat-note">finalizadas</span>
          </article>
        </section>

        <section className="dashboard-grid">
          <div className="routes-panel panel">
            <div className="panel-heading">
              <div>
                <h2>Minhas rotas</h2>
                <p>Selecione uma rota para ver o andamento</p>
              </div>
              <label className="search-box">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar rota..."
                  aria-label="Buscar rota"
                />
              </label>
            </div>

            <div className="fixed-points-card">
              <div className="fixed-points-icon"><MapPin size={18} /></div>
              <div>
                <strong>Pontos fixos da operação</strong>
                <p>Partida e chegada usadas em todas as rotas.</p>
              </div>
              <div className="fixed-points-status">
                <span className={fixedPoints.departurePointUrl ? "configured" : "missing"}>
                  {fixedPoints.departurePointUrl ? "Partida configurada" : "Definir partida"}
                </span>
                <span className={fixedPoints.arrivalPointUrl ? "configured" : "missing"}>
                  {fixedPoints.arrivalPointUrl ? "Chegada configurada" : "Definir chegada"}
                </span>
              </div>
              <button type="button" onClick={() => setPointsOpen(true)}>
                <Pencil size={14} /> Editar
              </button>
            </div>

            <div className="route-list">
              {!ready ? (
                <>
                  <div className="route-skeleton" />
                  <div className="route-skeleton" />
                  <div className="route-skeleton" />
                </>
              ) : filteredRoutes.length ? (
                filteredRoutes.map((route) => {
                  const status = getStatus(route, nowMinutes);
                  const progress = getProgress(route, nowMinutes);
                  const firstStage = route.stops.find((stop) => stop.type === "stage");
                  return (
                    <button
                      key={route.id}
                      type="button"
                      className={`route-card ${selectedRoute?.id === route.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(route.id)}
                    >
                      <span className="route-card-time">{route.departure}</span>
                      <span className="route-card-main">
                        <span className="route-card-top">
                          <strong>{route.name}</strong>
                          <span className={`status-badge ${statusCopy[status].className}`}>
                            {status === "active" && <i />}
                            {statusCopy[status].label}
                          </span>
                        </span>
                        <span className="route-destination">
                          <MapPin size={14} />
                          Chegada prevista às {route.arrivalForecast}
                          {firstStage?.stageNumber && (
                            <em>Stage {firstStage.stageNumber}</em>
                          )}
                          {isValidManualPath(route.manualPath) && (
                            <em>Traçado manual</em>
                          )}
                        </span>
                        <span className="progress-row">
                          <span className="progress-track">
                            <i style={{ width: `${progress}%` }} />
                          </span>
                          <small>{progress}%</small>
                        </span>
                        <span className="next-stop">
                          <Clock3 size={14} />
                          {getActiveLabel(route, nowMinutes)}
                        </span>
                      </span>
                      <ArrowRight className="route-arrow" size={18} />
                    </button>
                  );
                })
              ) : (
                <div className="empty-state">
                  <span><Map size={25} /></span>
                  <strong>Nenhuma rota encontrada</strong>
                  <p>Crie uma nova rota ou altere os filtros.</p>
                  <button type="button" onClick={openNewRoute}>
                    <Plus size={16} /> Adicionar rota
                  </button>
                </div>
              )}
            </div>
          </div>

          <aside className="detail-panel panel">
            {selectedRoute ? (
              <RouteDetail
                route={selectedRoute}
                fixedPoints={fixedPoints}
                nowMinutes={nowMinutes}
                onEdit={() => openEditRoute(selectedRoute)}
                onAddFuel={() => addFuelStop(selectedRoute)}
                onDelete={() => deleteRoute(selectedRoute)}
              />
            ) : (
              <div className="detail-empty">
                <span><RouteIcon size={27} /></span>
                <h3>Selecione uma rota</h3>
                <p>Os detalhes e o andamento aparecerão aqui.</p>
              </div>
            )}
          </aside>
        </section>
      </main>

      {modalOpen && draft && (
        <RouteModal
          draft={draft}
          setDraft={setDraft}
          onClose={() => {
            setModalOpen(false);
            setDraft(null);
          }}
          onSave={saveRoute}
        />
      )}

      {backupOpen && (
        <BackupModal
          routeCount={routes.length}
          message={backupMessage}
          onExport={exportBackup}
          onImport={importBackup}
          onClose={() => {
            setBackupOpen(false);
            setBackupMessage(null);
          }}
        />
      )}

      {pointsOpen && (
        <FixedPointsModal
          points={fixedPoints}
          onClose={() => setPointsOpen(false)}
          onSave={saveFixedPoints}
        />
      )}

      {gpsPointDraft && (
        <GpsPointConfigModal
          point={gpsPointDraft.point}
          initialConfig={gpsPointDraft}
          onClose={() => setGpsPointDraft(null)}
          onSave={(config) => saveGpsPointConfig(gpsPointDraft.point.id, config)}
        />
      )}

      {gpsPointEditDraft && (
        <GpsPointEditorModal
          draft={gpsPointEditDraft}
          pointCount={gpsPoints.length + (gpsPointEditDraft.isNew ? 1 : 0)}
          onClose={() => setGpsPointEditDraft(null)}
          onSave={(name, position) => saveGpsPointEditor(gpsPointEditDraft, name, position)}
        />
      )}
    </div>
  );
}

function RouteDetail({
  route,
  fixedPoints,
  nowMinutes,
  onEdit,
  onAddFuel,
  onDelete
}: {
  route: TruckRoute;
  fixedPoints: FixedPoints;
  nowMinutes: number;
  onEdit: () => void;
  onAddFuel: () => void;
  onDelete: () => void;
}) {
  const status = getStatus(route, nowMinutes);
  const progress = getProgress(route, nowMinutes);
  const orderedStops = [...route.stops].sort(
    (first, second) => toMinutes(first.start) - toMinutes(second.start)
  );

  return (
    <div className="detail-content">
      <div className="detail-heading">
        <div>
          <span className={`status-badge ${statusCopy[status].className}`}>
            {status === "active" && <i />}
            {statusCopy[status].label}
          </span>
          <h2>{route.name}</h2>
          {isValidManualPath(route.manualPath) && (
            <p className="manual-route-detail-note">
              <RouteIcon size={14} /> Traçado manual com {route.manualPath.length} pontos no mapa GPS
            </p>
          )}
          {fixedPoints.arrivalPointUrl ? (
            <a
              className="location-link"
              href={fixedPoints.arrivalPointUrl}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={14} /> Abrir chegada no Google Maps <ExternalLink size={12} />
            </a>
          ) : (
            <p><MapPin size={14} /> Localização não informada</p>
          )}
        </div>
        <div className="icon-actions">
          <button type="button" aria-label="Editar rota" onClick={onEdit}>
            <Pencil size={17} />
          </button>
          <button className="danger" type="button" aria-label="Excluir rota" onClick={onDelete}>
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      <div className="detail-metrics route-metrics-two">
        <div>
          <span><Clock3 size={15} /> Partida</span>
          <strong>{route.departure}</strong>
        </div>
        <div>
          <span><Clock3 size={15} /> Chegada prevista</span>
          <strong>{route.arrivalForecast}</strong>
        </div>
      </div>

      <div className="journey-header">
        <h3>Itinerário da rota</h3>
        <span>Na ordem em que será feito</span>
      </div>
      <div className="journey-points">
        <JourneyPoint
          icon={Truck}
          title="Ponto de partida"
          subtitle="Estacionamento de saída"
          time={route.departure}
          href={fixedPoints.departurePointUrl}
        />

        <div className="itinerary-section-heading">
          <div>
            <strong>Entradas e configurações da rota</strong>
            <span>Stages, taikis e almoço cadastrados</span>
          </div>
          <button type="button" onClick={onEdit}>
            <Pencil size={13} /> Configurar rota
          </button>
        </div>

        {orderedStops.map((stop) => {
          const meta = stopMeta[stop.type];
          return (
            <JourneyPoint
              key={stop.id}
              icon={meta.icon}
              title={
                stop.type === "stage"
                  ? `${stageOperationCopy[stop.stageOperation ?? "unloading"]} — Stage ${stop.stageNumber || "—"}`
                  : meta.label
              }
              subtitle={stop.label || meta.label}
              time={`${stop.start} — ${stop.end}`}
              href=""
            />
          );
        })}

        {route.fuelStop && (
          <JourneyPoint
            icon={Fuel}
            title="Abastecimento"
            subtitle="Parada antes da chegada"
            href={route.fuelStop.locationUrl}
            actionLabel="Editar abastecimento"
            onAction={onEdit}
            tone="fuel"
          />
        )}
        <JourneyPoint
          icon={MapPin}
          title="Ponto de chegada"
          subtitle="Estacionamento de chegada"
          time={route.arrivalForecast}
          href={fixedPoints.arrivalPointUrl}
          actionLabel={route.fuelStop ? undefined : "Adicionar abastecimento"}
          onAction={route.fuelStop ? undefined : onAddFuel}
          isLast
        />
      </div>

      <div className="overall-progress">
        <div>
          <span>Progresso da rota</span>
          <strong>{progress}%</strong>
        </div>
        <span className="progress-track large">
          <i style={{ width: `${progress}%` }} />
        </span>
      </div>

    </div>
  );
}

function JourneyPoint({
  icon: Icon,
  title,
  subtitle,
  time,
  href,
  actionLabel,
  onAction,
  tone,
  isLast = false
}: {
  icon: typeof Truck;
  title: string;
  subtitle: string;
  time?: string;
  href: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "fuel";
  isLast?: boolean;
}) {
  return (
    <div className={`journey-point${tone ? ` journey-point-${tone}` : ""}`}>
      <div className="journey-rail">
        <span><Icon size={15} /></span>
        {!isLast && <i />}
      </div>
      <div className="journey-copy">
        <div>
          <strong>{title}</strong>
          <p>{subtitle}</p>
          {href ? (
            <a href={href} target="_blank" rel="noreferrer">
              Abrir localização <ExternalLink size={11} />
            </a>
          ) : (
            <em>Localização não informada</em>
          )}
        </div>
        <div className="journey-side">
          {time && <time>{time}</time>}
          {actionLabel && onAction && (
            <button type="button" onClick={onAction}>
              {actionLabel === "Adicionar abastecimento" ? <Fuel size={13} /> : <Pencil size={13} />}
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RouteModal({
  draft,
  setDraft,
  onClose,
  onSave
}: {
  draft: TruckRoute;
  setDraft: React.Dispatch<React.SetStateAction<TruckRoute | null>>;
  onClose: () => void;
  onSave: (event: React.FormEvent) => void;
}) {
  function update<K extends keyof TruckRoute>(key: K, value: TruckRoute[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function addStop(type: StopType) {
    const defaults: Record<StopType, Omit<RouteStop, "id" | "type">> = {
      stage: {
        label: "Entrega",
        stageNumber: "",
        stageOperation: "unloading",
        start: "08:00",
        end: "09:00"
      },
      taiki: {
        label: "Área de espera",
        start: "08:00",
        end: "08:30"
      },
      lunch: {
        label: "Almoço",
        start: "12:00",
        end: "13:00"
      }
    };
    update("stops", [
      ...draft.stops,
      { id: cryptoId(), type, ...defaults[type] }
    ]);
  }

  function updateStop(id: string, patch: Partial<RouteStop>) {
    update(
      "stops",
      draft.stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop))
    );
  }

  function removeStop(id: string) {
    update(
      "stops",
      draft.stops.filter((stop) => stop.id !== id)
    );
  }

  function addFuelStop() {
    update("fuelStop", { locationUrl: "" });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="route-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{draft.id ? "EDITAR PLANEJAMENTO" : "NOVO PLANEJAMENTO"}</span>
            <h2 id="modal-title">{draft.id ? "Editar rota" : "Criar nova rota"}</h2>
            <p>Defina os horários e monte as etapas desta rota.</p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSave}>
          <div className="modal-scroll">
            {isValidManualPath(draft.manualPath) && (
              <div className="manual-route-ready">
                <RouteIcon size={18} />
                <div>
                  <strong>Traçado manual pronto</strong>
                  <p>
                    {draft.manualPath.length} pontos desenhados no mapa serão vinculados a esta rota.
                  </p>
                </div>
              </div>
            )}
            <div className="form-section">
              <div className="form-section-title">
                <span>1</span>
                <div>
                  <h3>Informações da rota</h3>
                  <p>Horários e previsão de chegada</p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field field-wide">
                  <span>Nome da rota</span>
                  <input
                    required
                    value={draft.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="Ex.: Toyota Motomachi"
                  />
                </label>
                <label className="field">
                  <span>Horário de partida</span>
                  <input
                    type="time"
                    required
                    value={draft.departure}
                    onChange={(event) => update("departure", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Previsão de chegada</span>
                  <input
                    type="time"
                    required
                    value={draft.arrivalForecast}
                    onChange={(event) => update("arrivalForecast", event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-title">
                <span>2</span>
                <div>
                  <h3>Etapas da rota</h3>
                  <p>Adicione stages, taikis e horário de almoço</p>
                </div>
              </div>

              <div className="stop-list">
                {draft.stops.map((stop, index) => {
                  const meta = stopMeta[stop.type];
                  const Icon = meta.icon;
                  return (
                    <div className={`stop-editor stop-${meta.color}`} key={stop.id}>
                      <div className="stop-editor-head">
                        <span className="stop-number">{index + 1}</span>
                        <span className="stop-type-icon"><Icon size={16} /></span>
                        <select
                          value={stop.type}
                          aria-label="Tipo de etapa"
                          onChange={(event) => {
                            const type = event.target.value as StopType;
                            updateStop(stop.id, {
                              type,
                              label: stopMeta[type].label,
                              stageNumber: type === "stage" ? stop.stageNumber : undefined,
                              stageOperation: type === "stage" ? stop.stageOperation ?? "unloading" : undefined
                            });
                          }}
                        >
                          <option value="stage">Stage</option>
                          <option value="taiki">Taiki</option>
                          <option value="lunch">Almoço</option>
                        </select>
                        <button
                          type="button"
                          aria-label="Remover etapa"
                          onClick={() => removeStop(stop.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="stop-fields">
                        {stop.type === "stage" && (
                          <>
                            <label className="field stage-field">
                              <span>Nº do Stage</span>
                              <input
                                required
                                value={stop.stageNumber ?? ""}
                                onChange={(event) =>
                                  updateStop(stop.id, { stageNumber: event.target.value })
                                }
                                placeholder="05"
                              />
                            </label>
                            <label className="field stage-operation-field">
                              <span>Operação</span>
                              <select
                                aria-label="Operação do Stage"
                                value={stop.stageOperation ?? "unloading"}
                                onChange={(event) =>
                                  updateStop(stop.id, {
                                    stageOperation: event.target.value as StageOperation
                                  })
                                }
                              >
                                <option value="loading">Carregamento</option>
                                <option value="unloading">Descarregamento</option>
                              </select>
                            </label>
                          </>
                        )}
                        <label className="field stop-name-field">
                          <span>Nome / observação</span>
                          <input
                            value={stop.label}
                            onChange={(event) =>
                              updateStop(stop.id, { label: event.target.value })
                            }
                            placeholder={meta.label}
                          />
                        </label>
                        <label className="field">
                          <span>Entrada</span>
                          <input
                            type="time"
                            required
                            value={stop.start}
                            onChange={(event) =>
                              updateStop(stop.id, { start: event.target.value })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Saída</span>
                          <input
                            type="time"
                            required
                            min={stop.start}
                            value={stop.end}
                            onChange={(event) =>
                              updateStop(stop.id, { end: event.target.value })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="add-stop-row">
                <span>Adicionar etapa:</span>
                <button type="button" onClick={() => addStop("stage")}>
                  <MapPin size={15} /> Stage
                </button>
                <button type="button" onClick={() => addStop("taiki")}>
                  <CircleParking size={15} /> Taiki
                </button>
                <button type="button" onClick={() => addStop("lunch")}>
                  <Coffee size={15} /> Almoço
                </button>
              </div>
            </div>

            <div className="form-section fuel-form-section">
              <div className="form-section-title">
                <span>3</span>
                <div>
                  <h3>Abastecimento antes da chegada</h3>
                  <p>Opcional: esta parada será colocada logo antes do ponto de chegada.</p>
                </div>
              </div>
              <div className="fuel-editor">
                {draft.fuelStop ? (
                  <>
                    <div className="fuel-editor-heading">
                      <span><Fuel size={16} /></span>
                      <strong>Local de abastecimento</strong>
                      <button type="button" onClick={() => update("fuelStop", undefined)}>
                        Remover
                      </button>
                    </div>
                    <label className="field">
                      <span>Link do abastecimento no Google Maps</span>
                      <div className="input-icon">
                        <Fuel size={16} />
                        <input
                          type="url"
                          value={draft.fuelStop.locationUrl}
                          onChange={(event) => update("fuelStop", { locationUrl: event.target.value })}
                          placeholder="Cole o link do posto"
                        />
                      </div>
                    </label>
                  </>
                ) : (
                  <button className="add-fuel-button" type="button" onClick={addFuelStop}>
                    <Fuel size={16} /> Adicionar abastecimento antes da chegada
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary-button" type="submit">
              <Check size={18} />
              {draft.id ? "Salvar alterações" : "Criar rota"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function GpsPointConfigModal({
  point,
  initialConfig,
  onClose,
  onSave
}: {
  point: GpxWaypoint;
  initialConfig: GpsPointConfig;
  onClose: () => void;
  onSave: (config: GpsPointConfig) => void;
}) {
  const waypointTime = waypointTimeLabel(point.time, point.description);
  const defaultStart = /^\d{2}:\d{2}$/.test(waypointTime) ? waypointTime : "08:00";
  const [hasStartTime, setHasStartTime] = useState(Boolean(initialConfig.startTime));
  const [hasArrivalTime, setHasArrivalTime] = useState(Boolean(initialConfig.arrivalTime));
  const [startTime, setStartTime] = useState(initialConfig.startTime);
  const [arrivalTime, setArrivalTime] = useState(initialConfig.arrivalTime);
  const [stops, setStops] = useState(() => initialConfig.stops.map((stop) => ({ ...stop })));

  function addStop(type: StopType) {
    const start =
      stops.at(-1)?.end ||
      (hasArrivalTime ? arrivalTime : "") ||
      (hasStartTime ? startTime : "") ||
      defaultStart;
    const duration = type === "stage" ? 60 : type === "taiki" ? 30 : 60;
    const defaults: Record<StopType, Omit<RouteStop, "id" | "type">> = {
      stage: {
        label: "Entrega",
        stageNumber: "",
        stageOperation: "unloading",
        start,
        end: minutesToTime(Math.min(toMinutes(start) + duration, 23 * 60 + 59))
      },
      taiki: {
        label: "Área de espera",
        start,
        end: minutesToTime(Math.min(toMinutes(start) + duration, 23 * 60 + 59))
      },
      lunch: {
        label: "Almoço",
        start,
        end: minutesToTime(Math.min(toMinutes(start) + duration, 23 * 60 + 59))
      }
    };
    setStops((current) => [...current, { id: cryptoId(), type, ...defaults[type] }]);
  }

  function updateStop(id: string, patch: Partial<RouteStop>) {
    setStops((current) => current.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)));
  }

  function removeStop(id: string) {
    setStops((current) => current.filter((stop) => stop.id !== id));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave({
      startTime: hasStartTime ? startTime : "",
      arrivalTime: hasArrivalTime ? arrivalTime : "",
      stops
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="route-modal gps-point-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gps-point-config-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">PONTO DA ROTA GPS</span>
            <h2 id="gps-point-config-title">Configurar etapas</h2>
            <p>{point.name} · {waypointTime} · ponto {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-scroll">
            <div className="form-section">
              <div className="form-section-title">
                <span>1</span>
                <div>
                  <h3>Horários opcionais</h3>
                  <p>Marque início e chegada somente nos pontos de referência certos.</p>
                </div>
              </div>
              <div className="gps-time-options" role="group" aria-label="Horários do ponto GPS">
                <label className="gps-time-option">
                  <input
                    type="checkbox"
                    checked={hasStartTime}
                    onChange={(event) => setHasStartTime(event.target.checked)}
                  />
                  <span>Adicionar horário de início</span>
                </label>
                <label className="gps-time-option">
                  <input
                    type="checkbox"
                    checked={hasArrivalTime}
                    onChange={(event) => setHasArrivalTime(event.target.checked)}
                  />
                  <span>Adicionar horário de chegada</span>
                </label>
              </div>

              {(hasStartTime || hasArrivalTime) && (
                <div className="form-grid gps-point-times-grid">
                  {hasStartTime && (
                    <label className="field">
                      <span>Horário de início</span>
                      <input
                        type="time"
                        aria-label="Horário de início do ponto"
                        required
                        value={startTime}
                        onChange={(event) => setStartTime(event.target.value)}
                      />
                    </label>
                  )}
                  {hasArrivalTime && (
                    <label className="field">
                      <span>Horário de chegada</span>
                      <input
                        type="time"
                        aria-label="Horário de chegada do ponto"
                        required
                        value={arrivalTime}
                        onChange={(event) => setArrivalTime(event.target.value)}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            <div className="form-section">
              <div className="form-section-title">
                <span>2</span>
                <div>
                  <h3>Etapas deste ponto</h3>
                  <p>Adicione Stage, Taiki e almoço para esta localização.</p>
                </div>
              </div>

              {stops.length ? (
                <div className="stop-list">
                  {stops.map((stop, index) => {
                    const meta = stopMeta[stop.type];
                    const Icon = meta.icon;
                    return (
                      <div className={`stop-editor stop-${meta.color}`} key={stop.id}>
                        <div className="stop-editor-head">
                          <span className="stop-number">{index + 1}</span>
                          <span className="stop-type-icon"><Icon size={16} /></span>
                          <select
                            value={stop.type}
                            aria-label="Tipo de etapa"
                            onChange={(event) => {
                              const type = event.target.value as StopType;
                              updateStop(stop.id, {
                              type,
                              label: stopMeta[type].label,
                              stageNumber: type === "stage" ? stop.stageNumber : undefined,
                              stageOperation: type === "stage" ? stop.stageOperation ?? "unloading" : undefined
                              });
                            }}
                          >
                            <option value="stage">Stage</option>
                            <option value="taiki">Taiki</option>
                            <option value="lunch">Almoço</option>
                          </select>
                          <button
                            type="button"
                            aria-label="Remover etapa"
                            onClick={() => removeStop(stop.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="stop-fields">
                        {stop.type === "stage" && (
                          <>
                            <label className="field stage-field">
                              <span>Nº do Stage</span>
                              <input
                                required
                                value={stop.stageNumber ?? ""}
                                onChange={(event) => updateStop(stop.id, { stageNumber: event.target.value })}
                                placeholder="05"
                              />
                            </label>
                            <label className="field stage-operation-field">
                              <span>Operação</span>
                              <select
                                aria-label="Operação do Stage"
                                value={stop.stageOperation ?? "unloading"}
                                onChange={(event) =>
                                  updateStop(stop.id, {
                                    stageOperation: event.target.value as StageOperation
                                  })
                                }
                              >
                                <option value="loading">Carregamento</option>
                                <option value="unloading">Descarregamento</option>
                              </select>
                            </label>
                          </>
                        )}
                          <label className="field stop-name-field">
                            <span>Nome / observação</span>
                            <input
                              value={stop.label}
                              onChange={(event) => updateStop(stop.id, { label: event.target.value })}
                              placeholder={meta.label}
                            />
                          </label>
                          <label className="field">
                            <span>Entrada</span>
                            <input
                              type="time"
                              required
                              value={stop.start}
                              onChange={(event) => updateStop(stop.id, { start: event.target.value })}
                            />
                          </label>
                          <label className="field">
                            <span>Saída</span>
                            <input
                              type="time"
                              required
                              min={stop.start}
                              value={stop.end}
                              onChange={(event) => updateStop(stop.id, { end: event.target.value })}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="gps-point-empty-steps">
                  <MapPin size={18} />
                  <span>Este ponto ainda não tem etapas configuradas.</span>
                </div>
              )}

              <div className="add-stop-row">
                <span>Adicionar etapa:</span>
                <button type="button" onClick={() => addStop("stage")}>
                  <MapPin size={15} /> Stage
                </button>
                <button type="button" onClick={() => addStop("taiki")}>
                  <CircleParking size={15} /> Taiki
                </button>
                <button type="button" onClick={() => addStop("lunch")}>
                  <Coffee size={15} /> Almoço
                </button>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary-button" type="submit">
              <Check size={18} /> Salvar etapas
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function GpsPointEditorModal({
  draft,
  pointCount,
  onClose,
  onSave
}: {
  draft: GpsPointEditDraft;
  pointCount: number;
  onClose: () => void;
  onSave: (name: string, position: number) => void;
}) {
  const [name, setName] = useState(draft.point.name);
  const [position, setPosition] = useState(String(draft.position));
  const endpointLabel = draft.endpointAssignment
    ? `${draft.endpointAssignment.side === "start" ? "Início" : "Fim"} do trecho ${draft.endpointAssignment.segmentIndex + 1}`
    : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const requestedPosition = Number.parseInt(position, 10);
    onSave(
      name,
      Math.min(Math.max(Number.isFinite(requestedPosition) ? requestedPosition : draft.position, 1), pointCount)
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="route-modal gps-point-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gps-point-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{draft.isNew ? "NOVO PONTO NO MAPA" : "PONTO DA ROTA GPS"}</span>
            <h2 id="gps-point-editor-title">
              {draft.isNew ? endpointLabel ?? "Adicionar ponto" : "Editar ponto"}
            </h2>
            <p>
              {endpointLabel
                ? "Dê um nome a este marcador. Ao salvar, ele ficará ligado a este trecho da rota."
                : draft.isNew
                ? "Defina o nome e a posição deste novo marcador na sua lista."
                : "Altere o nome e o número que aparecem no mapa e em Minhas rotas."}
            </p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-scroll">
            <div className="form-section">
              <div className="form-section-title">
                <span>1</span>
                <div>
                  <h3>Identificação do ponto</h3>
                  <p>O número reorganiza todos os marcadores automaticamente.</p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field field-wide">
                  <span>Nome do ponto</span>
                  <input
                    required
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: Shako"
                  />
                </label>
                <label className="field">
                  <span>Número na lista</span>
                  <input
                    type="number"
                    required
                    min="1"
                    max={pointCount}
                    inputMode="numeric"
                    value={position}
                    onChange={(event) => setPosition(event.target.value)}
                  />
                </label>
              </div>
              <div className="gps-point-coordinate-card">
                <MapPin size={17} />
                <div>
                  <span>Localização selecionada</span>
                  <strong>
                    {draft.point.latitude.toFixed(5)}, {draft.point.longitude.toFixed(5)}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary-button" type="submit">
              <Check size={18} /> {draft.isNew ? "Adicionar ponto" : "Salvar ponto"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FixedPointsModal({
  points,
  onClose,
  onSave
}: {
  points: FixedPoints;
  onClose: () => void;
  onSave: (points: FixedPoints) => void;
}) {
  const [draft, setDraft] = useState(points);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.departurePointUrl.trim() || !draft.arrivalPointUrl.trim()) return;
    onSave(draft);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fixed-points-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixed-points-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">CONFIGURAÇÃO GLOBAL</span>
            <h2 id="fixed-points-title">Pontos fixos da operação</h2>
            <p>Estes estacionamentos serão usados em todas as suas rotas.</p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="fixed-points-content">
            <label className="field">
              <span>Ponto de partida — estacionamento do caminhão</span>
              <div className="input-icon">
                <Truck size={16} />
                <input
                  type="url"
                  required
                  value={draft.departurePointUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, departurePointUrl: event.target.value }))}
                  placeholder="Cole o link do Google Maps da partida"
                />
              </div>
            </label>
            <label className="field">
              <span>Ponto de chegada — estacionamento do caminhão</span>
              <div className="input-icon">
                <MapPin size={16} />
                <input
                  type="url"
                  required
                  value={draft.arrivalPointUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, arrivalPointUrl: event.target.value }))}
                  placeholder="Cole o link do Google Maps da chegada"
                />
              </div>
            </label>
            <p className="fixed-points-note">
              Alterar estes links atualiza a partida e a chegada de todas as rotas, sem mudar seus horários ou etapas.
            </p>
          </div>
          <div className="modal-footer">
            <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
            <button className="primary-button" type="submit"><Check size={18} /> Salvar pontos fixos</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BackupModal({
  routeCount,
  message,
  onExport,
  onImport,
  onClose
}: {
  routeCount: number;
  message: BackupMessage | null;
  onExport: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="backup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">BACKUP E TRANSFERÊNCIA</span>
            <h2 id="backup-title">Leve suas rotas com você</h2>
            <p>Salve tudo em um arquivo ou restaure em outro aparelho.</p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="backup-content">
          <div className="backup-hero">
            <span><FileJson size={25} /></span>
            <div>
              <strong>Um arquivo, toda a configuração</strong>
              <p>
                O backup inclui pontos fixos, rotas, horários, stages, taikis,
                almoços, configurações, nomes, posições, cores e inícios/fins dos trechos GPS.
              </p>
            </div>
          </div>

          <div className="backup-options">
            <article className="backup-option">
              <span className="backup-option-icon export-icon">
                <Download size={20} />
              </span>
              <div>
                <h3>Exportar dados</h3>
                <p>
                  Baixe {routeCount} {routeCount === 1 ? "rota" : "rotas"} em um
                  arquivo JSON para guardar ou enviar.
                </p>
              </div>
              <button className="primary-button" type="button" onClick={onExport}>
                <Download size={17} />
                Baixar backup
              </button>
            </article>

            <article className="backup-option">
              <span className="backup-option-icon import-icon">
                <Upload size={20} />
              </span>
              <div>
                <h3>Importar dados</h3>
                <p>
                  Escolha um backup do Roteiro. Os dados atuais serão
                  substituídos após sua confirmação.
                </p>
              </div>
              <label className="secondary-button file-button" htmlFor="backup-file">
                <Upload size={17} />
                Escolher arquivo
              </label>
              <input
                id="backup-file"
                className="visually-hidden"
                type="file"
                accept=".json,application/json"
                onChange={onImport}
              />
            </article>
          </div>

          {message && (
            <div className={`backup-message ${message.type}`} role="status">
              {message.type === "success" ? (
                <CheckCircle2 size={17} />
              ) : (
                <X size={17} />
              )}
              {message.text}
            </div>
          )}

          <div className="backup-security">
            <ShieldCheck size={17} />
            <p>
              O arquivo contém apenas os dados das rotas. Nenhuma senha ou
              informação de acesso é incluída.
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </section>
    </div>
  );
}
