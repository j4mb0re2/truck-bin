import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { RouteSegmentTiming } from "./route-segment-utils";

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
  segmentTimings: RouteSegmentTiming[];
  waypoints: GpxWaypoint[];
  totalTrackPoints: number;
  renderedTrackPoints: number;
};

const EMPTY_ROUTE: GpxRouteData = {
  segments: [],
  segmentTimings: [],
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

function parseSegmentTiming(xml: string): RouteSegmentTiming {
  const expression = /<trkpt\b[^>]*>([\s\S]*?)<\/trkpt>/gi;
  let match: RegExpExecArray | null;
  let startTime = "";
  let endTime = "";

  while ((match = expression.exec(xml))) {
    const time = readTagText(match[1], "time");
    if (!time) continue;
    if (!startTime) startTime = time;
    endTime = time;
  }

  return { startTime, endTime };
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
    const cwd = process.cwd();
    const knownFiles = ["1.gpx", "rota.gpx"];
    const targetFiles = knownFiles.filter((file) => existsSync(path.join(cwd, file)));

    const rawSegments: Array<{ points: GpxCoordinate[]; timing: RouteSegmentTiming }> = [];
    const waypoints: GpxWaypoint[] = [];

    targetFiles.forEach((file) => {
      try {
        const filePath = path.join(cwd, file);
        if (!existsSync(filePath)) return;
        const source = readFileSync(filePath, "utf8");
        waypoints.push(...parseWaypoints(source));

        const segmentExpression = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
        let segmentMatch: RegExpExecArray | null;

        while ((segmentMatch = segmentExpression.exec(source))) {
          const points = parseTrackPoints(segmentMatch[1]);
          if (points.length) {
            rawSegments.push({ points, timing: parseSegmentTiming(segmentMatch[1]) });
          }
        }
      } catch {
        // ignore single unreadable file
      }
    });

    const nonEmptySegments = rawSegments.length || 1;
    const maxPerSegment = Math.max(120, Math.floor(MAX_RENDERED_POINTS / nonEmptySegments));
    const segments = rawSegments.map(({ points }) => sampleSegment(points, maxPerSegment));
    const segmentTimings = rawSegments.map(({ timing }) => timing);
    const totalTrackPoints = rawSegments.reduce((total, segment) => total + segment.points.length, 0);
    const renderedTrackPoints = segments.reduce((total, segment) => total + segment.length, 0);

    return {
      segments,
      segmentTimings,
      waypoints,
      totalTrackPoints,
      renderedTrackPoints
    };
  } catch {
    return EMPTY_ROUTE;
  }
}
