import { readFileSync } from "node:fs";
import path from "node:path";

export type GpxCoordinate = {
  latitude: number;
  longitude: number;
};

export type GpxWaypoint = GpxCoordinate & {
  id: string;
  name: string;
  description: string;
  time: string;
};

export type GpxRouteData = {
  segments: GpxCoordinate[][];
  waypoints: GpxWaypoint[];
  totalTrackPoints: number;
  renderedTrackPoints: number;
};

const EMPTY_ROUTE: GpxRouteData = {
  segments: [],
  waypoints: [],
  totalTrackPoints: 0,
  renderedTrackPoints: 0
};

const MAX_RENDERED_POINTS = 1_800;

function readAttribute(attributes: string, name: string) {
  return new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(attributes)?.[1] ?? "";
}

function readTagText(content: string, tag: string) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(content);
  return match?.[1].replace(/<[^>]+>/g, "").trim() ?? "";
}

function parseTrackPoints(xml: string) {
  const points: GpxCoordinate[] = [];
  const expression = /<trkpt\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(xml))) {
    const latitude = Number(readAttribute(match[1], "lat"));
    const longitude = Number(readAttribute(match[1], "lon"));
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      points.push({ latitude, longitude });
    }
  }

  return points;
}

function parseWaypoints(xml: string) {
  const waypoints: GpxWaypoint[] = [];
  const expression = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/gi;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(xml))) {
    const latitude = Number(readAttribute(match[1], "lat"));
    const longitude = Number(readAttribute(match[1], "lon"));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const name = readTagText(match[2], "name");
    const description = readTagText(match[2], "desc");
    const time = readTagText(match[2], "time");
    waypoints.push({
      id: `gpx-waypoint-${waypoints.length + 1}`,
      latitude,
      longitude,
      name: name || `Ponto ${waypoints.length + 1}`,
      description,
      time
    });
  }

  return waypoints;
}

function sampleSegment(points: GpxCoordinate[], maxPoints: number) {
  if (points.length <= maxPoints) return points;

  const stride = Math.ceil((points.length - 1) / (maxPoints - 1));
  const sampled = points.filter((_, index) => index === 0 || index % stride === 0);
  const lastPoint = points.at(-1);
  if (lastPoint && sampled.at(-1) !== lastPoint) sampled.push(lastPoint);
  return sampled;
}

export function loadGpxRoute(): GpxRouteData {
  try {
    const source = readFileSync(path.join(process.cwd(), "rota.gpx"), "utf8");
    const rawSegments: GpxCoordinate[][] = [];
    const segmentExpression = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
    let segmentMatch: RegExpExecArray | null;

    while ((segmentMatch = segmentExpression.exec(source))) {
      const points = parseTrackPoints(segmentMatch[1]);
      if (points.length) rawSegments.push(points);
    }

    const nonEmptySegments = rawSegments.length || 1;
    const maxPerSegment = Math.max(120, Math.floor(MAX_RENDERED_POINTS / nonEmptySegments));
    const segments = rawSegments.map((segment) => sampleSegment(segment, maxPerSegment));
    const totalTrackPoints = rawSegments.reduce((total, segment) => total + segment.length, 0);
    const renderedTrackPoints = segments.reduce((total, segment) => total + segment.length, 0);

    return {
      segments,
      waypoints: parseWaypoints(source),
      totalTrackPoints,
      renderedTrackPoints
    };
  } catch {
    return EMPTY_ROUTE;
  }
}
