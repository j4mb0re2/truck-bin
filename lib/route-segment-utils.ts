export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type RouteSegmentTiming = {
  startTime: string;
  endTime: string;
};

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

export function routeSegmentColor(index: number) {
  const safeIndex = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return ROUTE_SEGMENT_COLORS[safeIndex % ROUTE_SEGMENT_COLORS.length];
}

export function routeSegmentLabel(index: number) {
  if (index === 0) return "Trecho 1 — início da gravação";
  return `Trecho ${index + 1} — retomada após pausa`;
}

export function getRenderedRouteSegments(
  segments: RouteCoordinate[][],
  segmentTimings: RouteSegmentTiming[] = []
) {
  const renderedSegments: RenderedRouteSegment[] = [];

  segments.forEach((points, sourceIndex) => {
    if (points.length < 2) return;

    renderedSegments.push({
      index: renderedSegments.length,
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
