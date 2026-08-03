export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type RouteSegmentTiming = {
  startTime: string;
  endTime: string;
};

export type RouteSegmentColors = Record<number, string>;

export type SegmentEndpointSide = "start" | "end";

export type RouteSegmentEndpoint = {
  startPointId?: string;
  endPointId?: string;
};

export type RouteSegmentEndpoints = Record<number, RouteSegmentEndpoint>;

export type RouteProcedureType =
  | "inicio"
  | "carga"
  | "descarga"
  | "taiki"
  | "kiukei"
  | "fim";

export type RouteSegmentProcedure = {
  endpointSide: "start" | "end";
  procedureType: RouteProcedureType;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

export const PROCEDURE_CONFIG: Record<
  RouteProcedureType,
  { label: string; icon: string; description: string }
> = {
  inicio: { label: "Início", icon: "🟢", description: "Início da rota / deslocamento" },
  carga: { label: "Carga", icon: "📦", description: "Carregamento de produtos / fábrica" },
  descarga: { label: "Descarga", icon: "🚚", description: "Descarregamento / entrega" },
  taiki: { label: "Taiki", icon: "🅿️", description: "Estacionamento de espera" },
  kiukei: { label: "Kiukei", icon: "☕", description: "Pausa para descanso / refeição" },
  fim: { label: "Fim", icon: "🏁", description: "Fim da rota / encerramento" }
};

export type RouteSegmentDetail = {
  name?: string;
  departureTime?: string;
  arrivalTime?: string;
  procedure?: RouteSegmentProcedure;
};

export type RouteSegmentDetails = Record<number, RouteSegmentDetail>;

export type RenderedRouteSegment = {
  index: number;
  points: RouteCoordinate[];
  timing: RouteSegmentTiming;
};

const EMPTY_SEGMENT_TIMING: RouteSegmentTiming = {
  startTime: "",
  endTime: ""
};

export const ROUTE_SEGMENT_COLORS = [
  "#e76f32",
  "#247ba0",
  "#2f855a",
  "#805ad5",
  "#c05676",
  "#008f8c",
  "#bf8a20",
  "#5f7185"
] as const;

export function isRouteSegmentColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function isRouteSegmentDepartureTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function routeSegmentColor(index: number, customColors: RouteSegmentColors = {}) {
  const safeIndex = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  const customColor = customColors[safeIndex];
  if (isRouteSegmentColor(customColor)) return customColor;
  return ROUTE_SEGMENT_COLORS[safeIndex % ROUTE_SEGMENT_COLORS.length];
}

export function routeSegmentLabel(index: number) {
  if (index === 0) return "Rota 1";
  return `Trecho ${index + 1} — retomada após pausa`;
}

export function routeSegmentDisplayLabel(
  index: number,
  segmentDetails: RouteSegmentDetails = {}
) {
  const custom = segmentDetails[index]?.name?.trim();
  if (custom && custom !== "Trecho 1 — início da gravação" && custom !== "Trecho 1") {
    return custom;
  }
  return routeSegmentLabel(index);
}

export function getRenderedRouteSegments(
  segments: RouteCoordinate[][],
  segmentTimings: RouteSegmentTiming[] = [],
  customSegmentTracks: Record<number, RouteCoordinate[]> = {},
  clearedSegmentIndices: number[] = []
) {
  const clearedSet = new Set(clearedSegmentIndices);
  const renderedSegments: RenderedRouteSegment[] = [];

  segments.forEach((originalPoints, sourceIndex) => {
    if (clearedSet.has(sourceIndex)) return;

    const points = customSegmentTracks[sourceIndex]?.length
      ? customSegmentTracks[sourceIndex]
      : originalPoints;

    if (points.length < 2) return;

    renderedSegments.push({
      index: sourceIndex,
      points,
      timing: segmentTimings[sourceIndex] ?? EMPTY_SEGMENT_TIMING
    });
  });

  return renderedSegments;
}

function timestampFor(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function closestTimedSegmentIndex(
  pointTime: string | undefined,
  renderedSegments: RenderedRouteSegment[]
) {
  if (!pointTime) return null;

  const timestamp = timestampFor(pointTime);
  if (timestamp === null) return null;

  let closestIndex: number | null = null;
  let closestDifference = Number.POSITIVE_INFINITY;

  renderedSegments.forEach((segment) => {
    const start = timestampFor(segment.timing.startTime);
    const end = timestampFor(segment.timing.endTime);
    if (start === null && end === null) return;

    const first = start ?? end ?? timestamp;
    const last = end ?? start ?? timestamp;
    const lowerBound = Math.min(first, last);
    const upperBound = Math.max(first, last);
    const difference =
      timestamp < lowerBound
        ? lowerBound - timestamp
        : timestamp > upperBound
          ? timestamp - upperBound
          : 0;

    if (difference < closestDifference) {
      closestDifference = difference;
      closestIndex = segment.index;
    }
  });

  return closestIndex;
}

function squaredDistanceToLineSegment(
  point: RouteCoordinate,
  start: RouteCoordinate,
  end: RouteCoordinate
) {
  const longitudeScale = Math.cos((point.latitude * Math.PI) / 180);
  const pointX = point.longitude * longitudeScale;
  const pointY = point.latitude;
  const startX = start.longitude * longitudeScale;
  const startY = start.latitude;
  const endX = end.longitude * longitudeScale;
  const endY = end.latitude;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return (pointX - startX) ** 2 + (pointY - startY) ** 2;
  }

  const progress = Math.max(
    0,
    Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared)
  );
  const closestX = startX + progress * deltaX;
  const closestY = startY + progress * deltaY;
  return (pointX - closestX) ** 2 + (pointY - closestY) ** 2;
}

export function closestCoordinateOnPolyline(
  target: RouteCoordinate,
  points: RouteCoordinate[]
): RouteCoordinate {
  if (!points.length) return { ...target };
  if (points.length === 1) return { ...points[0] };

  const longitudeScale = Math.max(Math.cos((target.latitude * Math.PI) / 180), 0.0000001);
  const targetX = target.longitude * longitudeScale;
  const targetY = target.latitude;
  let closestCoordinate = points[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    const startX = start.longitude * longitudeScale;
    const startY = start.latitude;
    const endX = end.longitude * longitudeScale;
    const endY = end.latitude;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared === 0
      ? 0
      : Math.max(
        0,
        Math.min(1, ((targetX - startX) * deltaX + (targetY - startY) * deltaY) / lengthSquared)
      );
    const longitude = start.longitude + (end.longitude - start.longitude) * progress;
    const latitude = start.latitude + (end.latitude - start.latitude) * progress;
    const distance = (targetX - longitude * longitudeScale) ** 2 + (targetY - latitude) ** 2;

    if (distance < closestDistance) {
      closestDistance = distance;
      closestCoordinate = { latitude, longitude };
    }
  }

  return closestCoordinate;
}

function closestGeographicSegmentIndex(
  point: RouteCoordinate,
  renderedSegments: RenderedRouteSegment[]
) {
  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  renderedSegments.forEach((segment) => {
    for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex += 1) {
      const start = segment.points[pointIndex - 1];
      const end = segment.points[pointIndex];
      const distance = squaredDistanceToLineSegment(point, start, end);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = segment.index;
      }
    }
  });

  return closestIndex;
}

export function matchPointToRouteSegment(
  point: RouteCoordinate & { time?: string },
  segments: RouteCoordinate[][],
  segmentTimings: RouteSegmentTiming[] = []
) {
  const renderedSegments = getRenderedRouteSegments(segments, segmentTimings);
  if (!renderedSegments.length) return null;

  return (
    closestTimedSegmentIndex(point.time, renderedSegments) ??
    closestGeographicSegmentIndex(point, renderedSegments)
  );
}

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
