"use client";

import {
  ArrowLeft,
  Crosshair,
  Eye,
  EyeOff,
  Globe,
  Layers,
  MapPinned,
  Navigation,
  Pencil,
  Plus,
  Radio,
  Route,
  Satellite,
  Save,
  TriangleAlert,
  Undo2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { GpxCoordinate, GpxRouteData } from "../lib/gpx-route";
import {
  closestCoordinateOnPolyline,
  getRenderedRouteSegments,
  routeSegmentColor,
  routeSegmentDisplayLabel,
  routeSegmentLabel
} from "../lib/route-segment-utils";
import type {
  RouteSegmentColors,
  RouteSegmentDetail,
  RouteSegmentDetails,
  RouteSegmentEndpoints,
  SegmentEndpointSide
} from "../lib/route-segment-utils";

type GpsState = "idle" | "searching" | "tracking" | "error";
type LivePosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  updatedAt: string;
};
type EndpointMapSelection =
  | {
      kind: "segment";
      segmentIndex: number;
      side: SegmentEndpointSide;
    }
  | {
      kind: "manual-route";
      routeId: string;
      side: SegmentEndpointSide;
    };
function parseTimeToMinutes(time: string | undefined): number {
  if (!time) return Number.POSITIVE_INFINITY;
  const parts = time.split(":").map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return Number.POSITIVE_INFINITY;
  }
  return parts[0] * 60 + parts[1];
}

type ManualRouteSetup = {
  startPointId?: string;
  endPointId?: string;
  departureTime?: string;
  arrivalTime?: string;
};
export type ManualMapRoute = {
  id: string;
  name: string;
  color?: string;
  setup: ManualRouteSetup;
  points: GpxCoordinate[];
};
type RouteBoundaryMarker = {
  segmentIndex: number;
  marker: import("leaflet").Marker;
};

const MANUAL_ROUTE_COLORS = ["#0f766e", "#b7791f", "#5b5bd6", "#b45363"] as const;
type LeafletApi = typeof import("leaflet");

function formatWaypointTime(time: string, description: string) {
  const fromDescription = description.match(/\b(\d{2}:\d{2})(?::\d{2})?\b/)?.[1];
  if (fromDescription) return fromDescription;
  return time ? time.slice(11, 16) : "Ponto GPS";
}

function formatRecordingTime(time: string) {
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp)) return "Não informado";

  return new Date(timestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isSameCoordinate(first: GpxCoordinate, second: GpxCoordinate) {
  return (
    Math.abs(first.latitude - second.latitude) < 0.0000001 &&
    Math.abs(first.longitude - second.longitude) < 0.0000001
  );
}

function gpsErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Acesso à localização bloqueado. No iPhone: Ajustes > Privacidade e Segurança > Serviços de Localização > Safari > Durante o Uso do App.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Sinal de GPS indisponível no dispositivo. Verifique se o GPS do iPhone está ativado e tente em local aberto.";
  }
  return "O GPS demorou a responder. Toque em 'Ativar GPS' para tentar novamente.";
}

function tooltipText(content: string) {
  const element = document.createElement("span");
  element.textContent = content;
  return element;
}

function departureCopy(departureTime: string | undefined) {
  return departureTime ? ` · Saída às ${departureTime}` : "";
}

function arrivalCopy(arrivalTime: string | undefined) {
  return arrivalTime ? ` · Chegada às ${arrivalTime}` : "";
}

function segmentScheduleCopy(detail: RouteSegmentDetail | undefined) {
  return `${departureCopy(detail?.departureTime)}${arrivalCopy(detail?.arrivalTime)}`;
}

function manualRouteScheduleCopy(setup: ManualRouteSetup) {
  return `${departureCopy(setup.departureTime)}${arrivalCopy(setup.arrivalTime)}`;
}

function SegmentDetailsForm({
  segmentIndex,
  detail,
  endpoints,
  waypoints,
  disabled,
  canMarkEndpoints,
  isMarkingStart,
  isMarkingEnd,
  onSave,
  onAssignEndpoint,
  onMarkEndpoint
}: {
  segmentIndex: number;
  detail: RouteSegmentDetail | undefined;
  endpoints: RouteSegmentEndpoints[number];
  waypoints: ReadonlyArray<{ id: string; name: string }>;
  disabled: boolean;
  canMarkEndpoints: boolean;
  isMarkingStart: boolean;
  isMarkingEnd: boolean;
  onSave: (detail: RouteSegmentDetail) => void;
  onAssignEndpoint: (side: SegmentEndpointSide, pointId: string | null) => void;
  onMarkEndpoint: (side: SegmentEndpointSide) => void;
}) {
  const [name, setName] = useState(() => detail?.name ?? "");
  const [departureTime, setDepartureTime] = useState(() => detail?.departureTime ?? "");
  const [arrivalTime, setArrivalTime] = useState(() => detail?.arrivalTime ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ name, departureTime, arrivalTime });
  }

  return (
    <form className="gps-segment-details" onSubmit={submit}>
      <label className="gps-segment-detail-name">
        <span>Nome do trecho</span>
        <input
          type="text"
          value={name}
          placeholder={`Trecho ${segmentIndex + 1}`}
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="gps-segment-endpoint-controls">
        <section className="gps-segment-endpoint-group" aria-label="Ponto de início do trecho">
          <div className="gps-segment-endpoint-row">
            <label className="gps-segment-endpoint-field">
              <span>Início</span>
              <select
                value={endpoints.startPointId ?? ""}
                disabled={disabled}
                onChange={(event) => onAssignEndpoint("start", event.target.value || null)}
              >
                <option value="">Usar início da gravação</option>
                {waypoints.map((point, pointIndex) => (
                  <option key={point.id} value={point.id}>
                    {pointIndex + 1}. {point.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`gps-mark-endpoint-button ${isMarkingStart ? "is-active" : ""}`}
              type="button"
              disabled={!canMarkEndpoints}
              aria-pressed={isMarkingStart}
              onClick={() => onMarkEndpoint("start")}
            >
              <MapPinned size={12} /> {isMarkingStart ? "Clique na linha" : "Marcar na linha"}
            </button>
          </div>
          <label className="gps-segment-endpoint-time">
            <span>Horário de saída</span>
            <input
              type="time"
              value={departureTime}
              disabled={disabled}
              onChange={(event) => setDepartureTime(event.target.value)}
            />
          </label>
        </section>
        <section className="gps-segment-endpoint-group" aria-label="Ponto de fim do trecho">
          <div className="gps-segment-endpoint-row">
            <label className="gps-segment-endpoint-field">
              <span>Fim</span>
              <select
                value={endpoints.endPointId ?? ""}
                disabled={disabled}
                onChange={(event) => onAssignEndpoint("end", event.target.value || null)}
              >
                <option value="">Usar fim da gravação</option>
                {waypoints.map((point, pointIndex) => (
                  <option key={point.id} value={point.id}>
                    {pointIndex + 1}. {point.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`gps-mark-endpoint-button ${isMarkingEnd ? "is-active" : ""}`}
              type="button"
              disabled={!canMarkEndpoints}
              aria-pressed={isMarkingEnd}
              onClick={() => onMarkEndpoint("end")}
            >
              <MapPinned size={12} /> {isMarkingEnd ? "Clique na linha" : "Marcar na linha"}
            </button>
          </div>
          <label className="gps-segment-endpoint-time">
            <span>Horário de chegada</span>
            <input
              type="time"
              value={arrivalTime}
              disabled={disabled}
              onChange={(event) => setArrivalTime(event.target.value)}
            />
          </label>
        </section>
      </div>
      <button className="gps-save-segment-details-button" type="submit" disabled={disabled}>
        <Save size={12} /> Salvar trecho
      </button>
    </form>
  );
}

function ManualRouteDetailsForm({
  routeName,
  setup,
  waypoints,
  disabled,
  canMarkEndpoints,
  isMarkingStart,
  isMarkingEnd,
  onMarkEndpoint,
  onSave
}: {
  routeName: string;
  setup: ManualRouteSetup;
  waypoints: ReadonlyArray<{ id: string; name: string }>;
  disabled: boolean;
  canMarkEndpoints: boolean;
  isMarkingStart: boolean;
  isMarkingEnd: boolean;
  onMarkEndpoint: (side: SegmentEndpointSide) => void;
  onSave: (name: string, setup: ManualRouteSetup) => void;
}) {
  const [name, setName] = useState(() => routeName);
  const [startPointId, setStartPointId] = useState(() => setup.startPointId ?? "");
  const [endPointId, setEndPointId] = useState(() => setup.endPointId ?? "");
  const [departureTime, setDepartureTime] = useState(() => setup.departureTime ?? "");
  const [arrivalTime, setArrivalTime] = useState(() => setup.arrivalTime ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(name, {
      startPointId: startPointId || undefined,
      endPointId: endPointId || undefined,
      departureTime,
      arrivalTime
    });
  }

  return (
    <form className="gps-segment-details gps-manual-route-details" onSubmit={submit}>
      <label className="gps-segment-detail-name">
        <span>Nome da rota</span>
        <input
          type="text"
          value={name}
          placeholder="Rota manual"
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="gps-segment-endpoint-controls">
        <section className="gps-segment-endpoint-group" aria-label={`Ponto de início de ${routeName}`}>
          <div className="gps-segment-endpoint-row">
            <label className="gps-segment-endpoint-field">
              <span>Ponto de início</span>
              <select
                value={startPointId}
                disabled={disabled}
                onChange={(event) => setStartPointId(event.target.value)}
              >
                <option value="">Usar início do traçado</option>
                {waypoints.map((point, pointIndex) => (
                  <option key={point.id} value={point.id}>
                    {pointIndex + 1}. {point.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`gps-mark-endpoint-button ${isMarkingStart ? "is-active" : ""}`}
              type="button"
              disabled={!canMarkEndpoints}
              aria-pressed={isMarkingStart}
              onClick={() => onMarkEndpoint("start")}
            >
              <MapPinned size={12} /> {isMarkingStart ? "Clique no mapa" : "Marcar no mapa"}
            </button>
          </div>
          <label className="gps-segment-endpoint-time">
            <span>Horário de início</span>
            <input
              type="time"
              value={departureTime}
              disabled={disabled}
              onChange={(event) => setDepartureTime(event.target.value)}
            />
          </label>
        </section>
        <section className="gps-segment-endpoint-group" aria-label={`Ponto de fim de ${routeName}`}>
          <div className="gps-segment-endpoint-row">
            <label className="gps-segment-endpoint-field">
              <span>Ponto de fim</span>
              <select
                value={endPointId}
                disabled={disabled}
                onChange={(event) => setEndPointId(event.target.value)}
              >
                <option value="">Usar fim do traçado</option>
                {waypoints.map((point, pointIndex) => (
                  <option key={point.id} value={point.id}>
                    {pointIndex + 1}. {point.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`gps-mark-endpoint-button ${isMarkingEnd ? "is-active" : ""}`}
              type="button"
              disabled={!canMarkEndpoints}
              aria-pressed={isMarkingEnd}
              onClick={() => onMarkEndpoint("end")}
            >
              <MapPinned size={12} /> {isMarkingEnd ? "Clique no mapa" : "Marcar no mapa"}
            </button>
          </div>
          <label className="gps-segment-endpoint-time">
            <span>Horário de fim</span>
            <input
              type="time"
              value={arrivalTime}
              disabled={disabled}
              onChange={(event) => setArrivalTime(event.target.value)}
            />
          </label>
        </section>
      </div>
      <button className="gps-save-segment-details-button" type="submit" disabled={disabled}>
        <Save size={12} /> Salvar pontos e horários
      </button>
    </form>
  );
}

export function GpsTrackingView({
  route,
  pointStepCounts,
  pointsPanel,
  segmentColors,
  segmentDetails,
  segmentEndpoints,
  manualRoutes,
  initialWaypointId,
  autoStartNavigation,
  navigationMode,
  activeRouteName,
  onExitNavigation,
  onAddPoint,
  onEditPoint,
  onSavePointPositions,
  onChangeSegmentColor,
  onChangeManualRouteColor,
  onSaveManualRouteSetup,
  onSaveSegmentDetails,
  onAssignSegmentEndpoint,
  onCreateSegmentEndpoint,
  onAssignManualRouteEndpoint,
  onCreateManualRouteEndpoint,
  onCreateManualRoute,
  onBack
}: {
  route: GpxRouteData;
  pointStepCounts: Record<string, number>;
  pointsPanel: ReactNode;
  segmentColors: RouteSegmentColors;
  segmentDetails: RouteSegmentDetails;
  segmentEndpoints: RouteSegmentEndpoints;
  manualRoutes: ManualMapRoute[];
  initialWaypointId: string | null;
  autoStartNavigation?: boolean;
  navigationMode?: boolean;
  activeRouteName?: string;
  onExitNavigation?: () => void;
  onAddPoint: (coordinate: GpxCoordinate) => void;
  onEditPoint: (pointId: string) => void;
  onSavePointPositions: (positions: Record<string, GpxCoordinate>) => void;
  onChangeSegmentColor: (segmentIndex: number, color: string) => void;
  onChangeManualRouteColor: (routeId: string, color: string) => void;
  onSaveManualRouteSetup: (
    routeId: string,
    name: string,
    setup: ManualRouteSetup
  ) => void;
  onSaveSegmentDetails: (segmentIndex: number, detail: RouteSegmentDetail) => void;
  onAssignSegmentEndpoint: (
    segmentIndex: number,
    side: SegmentEndpointSide,
    pointId: string | null
  ) => void;
  onCreateSegmentEndpoint: (
    segmentIndex: number,
    side: SegmentEndpointSide,
    coordinate: GpxCoordinate
  ) => void;
  onAssignManualRouteEndpoint: (
    routeId: string,
    side: SegmentEndpointSide,
    pointId: string
  ) => void;
  onCreateManualRouteEndpoint: (
    routeId: string,
    side: SegmentEndpointSide,
    coordinate: GpxCoordinate
  ) => void;
  onCreateManualRoute: (points: GpxCoordinate[]) => void;
  onBack: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<LeafletApi | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const [mapLayerType, setMapLayerType] = useState<"streets" | "satellite">("streets");
  const routeBoundsRef = useRef<import("leaflet").LatLngBounds | null>(null);
  const truckMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const accuracyCircleRef = useRef<import("leaflet").Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const livePositionRef = useRef<LivePosition | null>(null);
  const onAddPointRef = useRef(onAddPoint);
  const onEditPointRef = useRef(onEditPoint);
  const onSavePointPositionsRef = useRef(onSavePointPositions);
  const onCreateSegmentEndpointRef = useRef(onCreateSegmentEndpoint);
  const onAssignManualRouteEndpointRef = useRef(onAssignManualRouteEndpoint);
  const onCreateManualRouteEndpointRef = useRef(onCreateManualRouteEndpoint);
  const addPointModeRef = useRef(false);
  const isEditingPointsRef = useRef(false);
  const isDrawingManualRouteRef = useRef(false);
  const endpointMapSelectionRef = useRef<EndpointMapSelection | null>(null);
  const routeLineClickRef = useRef(false);
  const routeLinesRef = useRef<Record<number, import("leaflet").Polyline>>({});
  const manualRouteLinesRef = useRef<Record<string, import("leaflet").Polyline>>({});
  const routeBoundaryMarkersRef = useRef<RouteBoundaryMarker[]>([]);
  const hiddenRouteSegmentIndexSetRef = useRef<ReadonlySet<number>>(new Set());
  const hiddenManualRouteIdSetRef = useRef<ReadonlySet<string>>(new Set());
  const routeEndpointMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const manualRouteMarkersRef = useRef<Record<string, import("leaflet").Marker[]>>({});
  const manualRouteDraftRef = useRef<GpxCoordinate[]>([]);
  const manualRouteDraftLineRef = useRef<import("leaflet").Polyline | null>(null);
  const manualRoutePreviewLineRef = useRef<import("leaflet").Polyline | null>(null);
  const manualRouteDraftPointLayersRef = useRef<import("leaflet").Layer[]>([]);
  const waypointMarkersRef = useRef<Record<string, import("leaflet").Marker>>({});
  const pointPositionEditsRef = useRef<Record<string, GpxCoordinate>>({});
  const originalPointPositionsRef = useRef<Record<string, GpxCoordinate>>({});
  const [mapReady, setMapReady] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsMessage, setGpsMessage] = useState("GPS desligado — ative para localizar o caminhão.");
  const [livePosition, setLivePosition] = useState<LivePosition | null>(null);
  const [isAddingPoint, setIsAddingPoint] = useState(false);
  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const [pendingPointPositionCount, setPendingPointPositionCount] = useState(0);
  const [endpointMapSelection, setEndpointMapSelection] = useState<EndpointMapSelection | null>(null);
  const [selectedRouteSegmentIndex, setSelectedRouteSegmentIndex] = useState<number | null>(null);
  const [hiddenRouteSegmentIndexes, setHiddenRouteSegmentIndexes] = useState<number[]>([]);
  const [selectedManualRouteId, setSelectedManualRouteId] = useState<string | null>(null);
  const [hiddenManualRouteIds, setHiddenManualRouteIds] = useState<string[]>([]);
  const [isDrawingManualRoute, setIsDrawingManualRoute] = useState(false);
  const [manualRouteDraft, setManualRouteDraft] = useState<GpxCoordinate[]>([]);

  useEffect(() => {
    onAddPointRef.current = onAddPoint;
  }, [onAddPoint]);

  useEffect(() => {
    onEditPointRef.current = onEditPoint;
  }, [onEditPoint]);

  useEffect(() => {
    onSavePointPositionsRef.current = onSavePointPositions;
  }, [onSavePointPositions]);

  useEffect(() => {
    onCreateSegmentEndpointRef.current = onCreateSegmentEndpoint;
  }, [onCreateSegmentEndpoint]);

  useEffect(() => {
    onAssignManualRouteEndpointRef.current = onAssignManualRouteEndpoint;
  }, [onAssignManualRouteEndpoint]);

  useEffect(() => {
    onCreateManualRouteEndpointRef.current = onCreateManualRouteEndpoint;
  }, [onCreateManualRouteEndpoint]);

  useEffect(() => {
    addPointModeRef.current = isAddingPoint;
  }, [isAddingPoint]);

  const visibleRouteSegments = useMemo(
    () => getRenderedRouteSegments(route.segments, route.segmentTimings),
    [route.segmentTimings, route.segments]
  );
  const segmentDisplayLabels = useMemo(
    () => Object.fromEntries(
      visibleRouteSegments.map((segment) => [
        segment.index,
        routeSegmentDisplayLabel(segment.index, segmentDetails)
      ])
    ) as Record<number, string>,
    [segmentDetails, visibleRouteSegments]
  );
  const hiddenRouteSegmentIndexSet = useMemo(
    () => new Set(hiddenRouteSegmentIndexes),
    [hiddenRouteSegmentIndexes]
  );
  const hiddenManualRouteIdSet = useMemo(
    () => new Set(hiddenManualRouteIds),
    [hiddenManualRouteIds]
  );

  useEffect(() => {
    hiddenRouteSegmentIndexSetRef.current = hiddenRouteSegmentIndexSet;
  }, [hiddenRouteSegmentIndexSet]);
  useEffect(() => {
    hiddenManualRouteIdSetRef.current = hiddenManualRouteIdSet;
  }, [hiddenManualRouteIdSet]);
  const manualRoutePointCount = useMemo(
    () => manualRoutes.reduce((total, manualRoute) => total + manualRoute.points.length, 0),
    [manualRoutes]
  );
  const hasRoute = visibleRouteSegments.length > 0 || manualRoutes.length > 0;
  const initialWaypoint = route.waypoints.find((point) => point.id === initialWaypointId);
  const selectedManualRoute = manualRoutes.find((manualRoute) => manualRoute.id === selectedManualRouteId);
  const hasRouteFocus = selectedRouteSegmentIndex !== null || selectedManualRouteId !== null;

  const sortedVisibleRouteSegments = useMemo(() => {
    return [...visibleRouteSegments].sort((a, b) => {
      const depA = segmentDetails[a.index]?.departureTime || a.timing.startTime || "";
      const depB = segmentDetails[b.index]?.departureTime || b.timing.startTime || "";
      const minA = parseTimeToMinutes(depA);
      const minB = parseTimeToMinutes(depB);
      if (minA !== minB) return minA - minB;
      return a.index - b.index;
    });
  }, [visibleRouteSegments, segmentDetails]);

  const sortedManualRoutes = useMemo(() => {
    return [...manualRoutes].sort((a, b) => {
      const depA = a.setup?.departureTime || "";
      const depB = b.setup?.departureTime || "";
      const minA = parseTimeToMinutes(depA);
      const minB = parseTimeToMinutes(depB);
      if (minA !== minB) return minA - minB;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [manualRoutes]);

  const centerRoute = useCallback(() => {
    const map = mapRef.current;
    const bounds = routeBoundsRef.current;
    if (map && bounds?.isValid()) {
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: 14 });
    }
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGpsState("idle");
    setGpsMessage("GPS pausado.");
  }, []);

  const toggleMapLayerType = useCallback(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map) return;

    const nextType = mapLayerType === "streets" ? "satellite" : "streets";
    setMapLayerType(nextType);

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    if (nextType === "satellite") {
      tileLayerRef.current = leaflet.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
        }
      ).addTo(map);
    } else {
      tileLayerRef.current = leaflet.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors"
        }
      ).addTo(map);
    }
  }, [mapLayerType]);

  const toggleAddPointMode = useCallback(() => {
    if (
      isEditingPointsRef.current ||
      endpointMapSelectionRef.current ||
      isDrawingManualRouteRef.current
    ) {
      return;
    }

    setIsAddingPoint((currentMode) => {
      const nextMode = !currentMode;
      addPointModeRef.current = nextMode;
      return nextMode;
    });
  }, []);

  const clearEndpointMapSelection = useCallback(() => {
    endpointMapSelectionRef.current = null;
    setEndpointMapSelection(null);
  }, []);

  const focusRouteSegment = useCallback((segmentIndex: number | null) => {
    setSelectedRouteSegmentIndex(segmentIndex);
    if (segmentIndex !== null) setSelectedManualRouteId(null);
  }, []);

  const focusManualRoute = useCallback((routeId: string | null) => {
    setSelectedManualRouteId(routeId);
    if (routeId !== null) setSelectedRouteSegmentIndex(null);
  }, []);

  const toggleRouteSegmentVisibility = useCallback(
    (segmentIndex: number) => {
      const isVisible = !hiddenRouteSegmentIndexSet.has(segmentIndex);
      setHiddenRouteSegmentIndexes((current) =>
        isVisible
          ? [...current, segmentIndex]
          : current.filter((index) => index !== segmentIndex)
      );

      if (!isVisible) return;

      if (selectedRouteSegmentIndex === segmentIndex) {
        focusRouteSegment(null);
      }
      if (
        endpointMapSelectionRef.current?.kind === "segment" &&
        endpointMapSelectionRef.current.segmentIndex === segmentIndex
      ) {
        clearEndpointMapSelection();
      }
    },
    [clearEndpointMapSelection, focusRouteSegment, hiddenRouteSegmentIndexSet, selectedRouteSegmentIndex]
  );

  const toggleManualRouteVisibility = useCallback(
    (routeId: string) => {
      const isVisible = !hiddenManualRouteIdSet.has(routeId);
      setHiddenManualRouteIds((current) =>
        isVisible ? [...current, routeId] : current.filter((id) => id !== routeId)
      );

      if (isVisible && selectedManualRouteId === routeId) {
        focusManualRoute(null);
      }
      if (
        endpointMapSelectionRef.current?.kind === "manual-route" &&
        endpointMapSelectionRef.current.routeId === routeId
      ) {
        clearEndpointMapSelection();
      }
    },
    [clearEndpointMapSelection, focusManualRoute, hiddenManualRouteIdSet, selectedManualRouteId]
  );

  const addManualRouteDraftPoint = useCallback((coordinate: GpxCoordinate) => {
    const currentPoints = manualRouteDraftRef.current;
    const lastPoint = currentPoints.at(-1);
    if (lastPoint && isSameCoordinate(lastPoint, coordinate)) return;

    const nextPoints = [
      ...currentPoints,
      { latitude: coordinate.latitude, longitude: coordinate.longitude }
    ];
    manualRouteDraftRef.current = nextPoints;
    setManualRouteDraft(nextPoints);
  }, []);

  const startManualRouteDrawing = useCallback(() => {
    if (!mapReady || isEditingPointsRef.current) return;

    addPointModeRef.current = false;
    setIsAddingPoint(false);
    endpointMapSelectionRef.current = null;
    setEndpointMapSelection(null);
    focusRouteSegment(null);
    focusManualRoute(null);
    manualRouteDraftRef.current = [];
    setManualRouteDraft([]);
    isDrawingManualRouteRef.current = true;
    setIsDrawingManualRoute(true);
  }, [focusManualRoute, focusRouteSegment, mapReady]);

  const cancelManualRouteDrawing = useCallback(() => {
    isDrawingManualRouteRef.current = false;
    setIsDrawingManualRoute(false);
    manualRouteDraftRef.current = [];
    setManualRouteDraft([]);
  }, []);

  const undoManualRouteDraftPoint = useCallback(() => {
    const nextPoints = manualRouteDraftRef.current.slice(0, -1);
    manualRouteDraftRef.current = nextPoints;
    setManualRouteDraft(nextPoints);
  }, []);

  const saveManualRouteDrawing = useCallback(() => {
    const points = manualRouteDraftRef.current;
    if (points.length < 2) return;

    const savedPoints = points.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude
    }));
    cancelManualRouteDrawing();
    onCreateManualRoute(savedPoints);
  }, [cancelManualRouteDrawing, onCreateManualRoute]);

  const selectSegmentEndpointOnMap = useCallback(
    (segmentIndex: number, side: SegmentEndpointSide) => {
      if (!mapReady || isEditingPointsRef.current || isDrawingManualRouteRef.current) return;

      addPointModeRef.current = false;
      setIsAddingPoint(false);
      focusRouteSegment(segmentIndex);
      focusManualRoute(null);
      const selection = { kind: "segment" as const, segmentIndex, side };
      endpointMapSelectionRef.current = selection;
      setEndpointMapSelection(selection);
    },
    [focusManualRoute, focusRouteSegment, mapReady]
  );

  const selectManualRouteEndpointOnMap = useCallback(
    (routeId: string, side: SegmentEndpointSide) => {
      if (!mapReady || isEditingPointsRef.current || isDrawingManualRouteRef.current) return;

      addPointModeRef.current = false;
      setIsAddingPoint(false);
      setHiddenManualRouteIds((current) => current.filter((id) => id !== routeId));
      focusRouteSegment(null);
      focusManualRoute(routeId);
      const selection = { kind: "manual-route" as const, routeId, side };
      endpointMapSelectionRef.current = selection;
      setEndpointMapSelection(selection);
    },
    [focusManualRoute, focusRouteSegment, mapReady]
  );

  const setWaypointMarkersEditing = useCallback((editable: boolean) => {
    Object.values(waypointMarkersRef.current).forEach((marker) => {
      if (editable) marker.dragging?.enable();
      else marker.dragging?.disable();
    });
  }, []);

  const startPointEditing = useCallback(() => {
    if (!mapReady || isDrawingManualRouteRef.current) return;

    addPointModeRef.current = false;
    setIsAddingPoint(false);
    endpointMapSelectionRef.current = null;
    setEndpointMapSelection(null);
    pointPositionEditsRef.current = {};
    originalPointPositionsRef.current = Object.fromEntries(
      Object.entries(waypointMarkersRef.current).map(([pointId, marker]) => {
        const position = marker.getLatLng();
        return [pointId, { latitude: position.lat, longitude: position.lng }];
      })
    );
    isEditingPointsRef.current = true;
    setWaypointMarkersEditing(true);
    setPendingPointPositionCount(0);
    setIsEditingPoints(true);
  }, [mapReady, setWaypointMarkersEditing]);

  const cancelPointEditing = useCallback(() => {
    Object.entries(originalPointPositionsRef.current).forEach(([pointId, position]) => {
      waypointMarkersRef.current[pointId]?.setLatLng([position.latitude, position.longitude]);
    });
    setWaypointMarkersEditing(false);
    pointPositionEditsRef.current = {};
    originalPointPositionsRef.current = {};
    isEditingPointsRef.current = false;
    setPendingPointPositionCount(0);
    setIsEditingPoints(false);
  }, [setWaypointMarkersEditing]);

  const savePointEditing = useCallback(() => {
    const positions = { ...pointPositionEditsRef.current };
    if (Object.keys(positions).length) onSavePointPositionsRef.current(positions);

    setWaypointMarkersEditing(false);
    pointPositionEditsRef.current = {};
    originalPointPositionsRef.current = {};
    isEditingPointsRef.current = false;
    setPendingPointPositionCount(0);
    setIsEditingPoints(false);
  }, [setWaypointMarkersEditing]);

  const updateTruckMarker = useCallback(
    (position: Pick<LivePosition, "latitude" | "longitude" | "accuracy">) => {
      const leaflet = leafletRef.current;
      const map = mapRef.current;
      if (!leaflet || !map) return;

      const { latitude, longitude, accuracy } = position;
      const coordinates = leaflet.latLng(latitude, longitude);
      const truckIcon = leaflet.divIcon({
        className: "gps-truck-marker",
        html: "<span>🚚</span>",
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });

      if (!truckMarkerRef.current) {
        truckMarkerRef.current = leaflet
          .marker(coordinates, { icon: truckIcon, zIndexOffset: 800 })
          .bindTooltip("Meu caminhão", { permanent: false, direction: "top" })
          .addTo(map);
      } else {
        truckMarkerRef.current.setLatLng(coordinates);
      }

      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = leaflet
          .circle(coordinates, {
            radius: accuracy,
            color: "#2c6d9e",
            fillColor: "#2c6d9e",
            fillOpacity: 0.1,
            weight: 1
          })
          .addTo(map);
      } else {
        accuracyCircleRef.current.setLatLng(coordinates);
        accuracyCircleRef.current.setRadius(accuracy);
      }

      if (!isEditingPointsRef.current) {
        map.flyTo(coordinates, Math.max(map.getZoom(), 15), { duration: 0.65 });
      }
    },
    []
  );

  const startTracking = useCallback(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGpsState("error");
      setGpsMessage("Este navegador não oferece suporte a GPS.");
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setGpsState("searching");
    setGpsMessage("Procurando o sinal GPS do dispositivo…");

    const handleSuccess = (position: GeolocationPosition) => {
      const nextLivePosition = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        updatedAt: new Date(position.timestamp).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      };
      livePositionRef.current = nextLivePosition;
      updateTruckMarker(nextLivePosition);
      setLivePosition(nextLivePosition);
      setGpsState("tracking");
      setGpsMessage("Acompanhando o caminhão ao vivo.");
    };

    const startWatch = (highAccuracy: boolean) => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleSuccess,
        (error) => {
          if (highAccuracy && (error.code === error.TIMEOUT || error.code === error.POSITION_UNAVAILABLE)) {
            if (watchIdRef.current !== null) {
              navigator.geolocation.clearWatch(watchIdRef.current);
              watchIdRef.current = null;
            }
            startWatch(false);
            return;
          }
          setGpsState("error");
          setGpsMessage(gpsErrorMessage(error));
        },
        {
          enableHighAccuracy: highAccuracy,
          maximumAge: 5_000,
          timeout: highAccuracy ? 10_000 : 20_000
        }
      );
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleSuccess(position);
        startWatch(true);
      },
      (error) => {
        if (error.code === error.TIMEOUT || error.code === error.POSITION_UNAVAILABLE) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              handleSuccess(position);
              startWatch(false);
            },
            () => {
              startWatch(false);
            },
            {
              enableHighAccuracy: false,
              maximumAge: 10_000,
              timeout: 15_000
            }
          );
        } else {
          setGpsState("error");
          setGpsMessage(gpsErrorMessage(error));
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 8_000
      }
    );
  }, [updateTruckMarker]);

  useEffect(() => {
    if (mapReady && (autoStartNavigation || navigationMode) && gpsState === "idle") {
      const timerId = window.setTimeout(() => {
        startTracking();
      }, 0);
      return () => window.clearTimeout(timerId);
    }
  }, [mapReady, autoStartNavigation, navigationMode, gpsState, startTracking]);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    let onMapClick: ((event: import("leaflet").LeafletMouseEvent) => void) | null = null;
    let onMapMouseMove: ((event: import("leaflet").LeafletMouseEvent) => void) | null = null;

    async function createMap() {
      const leaflet = await import("leaflet");
      if (disposed || !mapContainerRef.current) return;

      leafletRef.current = leaflet;
      map = leaflet.map(mapContainerRef.current, {
        zoomControl: false,
        preferCanvas: true
      });
      const activeMap = map;
      mapRef.current = activeMap;
      leaflet.control.zoom({ position: "bottomright" }).addTo(activeMap);
      const initialTileLayer = leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors"
        })
        .addTo(activeMap);
      tileLayerRef.current = initialTileLayer;

      onMapClick = (event) => {
        if (isDrawingManualRouteRef.current) {
          addManualRouteDraftPoint({
            latitude: event.latlng.lat,
            longitude: event.latlng.lng
          });
          return;
        }

        const endpointSelection = endpointMapSelectionRef.current;
        if (endpointSelection?.kind === "manual-route") {
          endpointMapSelectionRef.current = null;
          setEndpointMapSelection(null);
          onCreateManualRouteEndpointRef.current(
            endpointSelection.routeId,
            endpointSelection.side,
            {
              latitude: event.latlng.lat,
              longitude: event.latlng.lng
            }
          );
          return;
        }

        if (!addPointModeRef.current) {
          if (routeLineClickRef.current) {
            routeLineClickRef.current = false;
            return;
          }

          if (!endpointMapSelectionRef.current && !isEditingPointsRef.current) {
            focusRouteSegment(null);
            focusManualRoute(null);
          }
          return;
        }

        addPointModeRef.current = false;
        setIsAddingPoint(false);
        onAddPointRef.current({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng
        });
      };
      activeMap.on("click", onMapClick);

      onMapMouseMove = (event) => {
        if (!isDrawingManualRouteRef.current) return;

        const lastPoint = manualRouteDraftRef.current.at(-1);
        const previewLine = manualRoutePreviewLineRef.current;
        if (!lastPoint || !previewLine) return;

        previewLine.setLatLngs([
          [lastPoint.latitude, lastPoint.longitude],
          [event.latlng.lat, event.latlng.lng]
        ]);
      };
      activeMap.on("mousemove", onMapMouseMove);

      const allCoordinates: [number, number][] = [];
      const gpxCoordinates: [number, number][] = [];
      waypointMarkersRef.current = {};
      routeLinesRef.current = {};
      manualRouteLinesRef.current = {};
      routeBoundaryMarkersRef.current = [];
      routeEndpointMarkersRef.current = [];
      manualRouteMarkersRef.current = {};
      const routePointsById = new globalThis.Map(
        route.waypoints.map((point) => [point.id, point])
      );
      visibleRouteSegments.forEach((segment) => {
        const coordinates = segment.points.map(
          (point) => [point.latitude, point.longitude] as [number, number]
        );
        const color = routeSegmentColor(segment.index, segmentColors);
        const segmentLabel = segmentDisplayLabels[segment.index] ?? routeSegmentLabel(segment.index);
        const segmentDetail = segmentDetails[segment.index];
        allCoordinates.push(...coordinates);
        gpxCoordinates.push(...coordinates);
        const routeLine = leaflet
          .polyline(coordinates, {
            color,
            weight: 5,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round"
          })
          .bindTooltip(tooltipText(`${segmentLabel}${segmentScheduleCopy(segmentDetail)}`));
        if (!hiddenRouteSegmentIndexSetRef.current.has(segment.index)) {
          routeLine.addTo(activeMap);
        }
        routeLinesRef.current[segment.index] = routeLine;

        routeLine.on("click", (event) => {
          if (isDrawingManualRouteRef.current) {
            leaflet.DomEvent.stopPropagation(event.originalEvent);
            addManualRouteDraftPoint({
              latitude: event.latlng.lat,
              longitude: event.latlng.lng
            });
            return;
          }

          routeLineClickRef.current = true;
          window.setTimeout(() => {
            routeLineClickRef.current = false;
          }, 0);
          leaflet.DomEvent.stopPropagation(event.originalEvent);
          focusRouteSegment(segment.index);

          const selection = endpointMapSelectionRef.current;
          if (
            !selection ||
            selection.kind !== "segment" ||
            selection.segmentIndex !== segment.index
          ) {
            return;
          }

          const coordinate = closestCoordinateOnPolyline(
            { latitude: event.latlng.lat, longitude: event.latlng.lng },
            segment.points
          );
          endpointMapSelectionRef.current = null;
          setEndpointMapSelection(null);
          onCreateSegmentEndpointRef.current(segment.index, selection.side, coordinate);
        });
      });

      manualRoutes.forEach((manualRoute, index) => {
        const coordinates = manualRoute.points.map(
          (point) => [point.latitude, point.longitude] as [number, number]
        );
        if (coordinates.length < 2) return;

        const color = manualRoute.color ?? MANUAL_ROUTE_COLORS[index % MANUAL_ROUTE_COLORS.length];
        const startPoint = manualRoute.setup.startPointId
          ? routePointsById.get(manualRoute.setup.startPointId)
          : undefined;
        const endPoint = manualRoute.setup.endPointId
          ? routePointsById.get(manualRoute.setup.endPointId)
          : undefined;
        allCoordinates.push(...coordinates);
        if (startPoint) allCoordinates.push([startPoint.latitude, startPoint.longitude]);
        if (endPoint) allCoordinates.push([endPoint.latitude, endPoint.longitude]);
        const manualRouteLine = leaflet
          .polyline(coordinates, {
            color,
            weight: 5,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
            interactive: true
          })
          .bindTooltip(
            tooltipText(
              `Rota manual · ${manualRoute.name}${manualRouteScheduleCopy(manualRoute.setup)}`
            )
          );
        if (!hiddenManualRouteIdSetRef.current.has(manualRoute.id)) {
          manualRouteLine.addTo(activeMap);
        }
        manualRouteLinesRef.current[manualRoute.id] = manualRouteLine;

        manualRouteLine.on("click", (event) => {
          if (isDrawingManualRouteRef.current) {
            leaflet.DomEvent.stopPropagation(event.originalEvent);
            addManualRouteDraftPoint({
              latitude: event.latlng.lat,
              longitude: event.latlng.lng
            });
            return;
          }

          routeLineClickRef.current = true;
          window.setTimeout(() => {
            routeLineClickRef.current = false;
          }, 0);
          leaflet.DomEvent.stopPropagation(event.originalEvent);

          const selection = endpointMapSelectionRef.current;
          if (selection?.kind === "manual-route") {
            if (selection.routeId !== manualRoute.id) return;

            const coordinate = closestCoordinateOnPolyline(
              { latitude: event.latlng.lat, longitude: event.latlng.lng },
              manualRoute.points
            );
            endpointMapSelectionRef.current = null;
            setEndpointMapSelection(null);
            onCreateManualRouteEndpointRef.current(
              manualRoute.id,
              selection.side,
              coordinate
            );
            return;
          }

          focusManualRoute(manualRoute.id);
        });

        const start = startPoint
          ? [startPoint.latitude, startPoint.longitude] as [number, number]
          : coordinates[0];
        const destination = endPoint
          ? [endPoint.latitude, endPoint.longitude] as [number, number]
          : coordinates.at(-1);
        const startPointNumber = startPoint
          ? route.waypoints.findIndex((point) => point.id === startPoint.id) + 1
          : 0;
        const endPointNumber = endPoint
          ? route.waypoints.findIndex((point) => point.id === endPoint.id) + 1
          : 0;
        const startLabel = startPointNumber ? `Início · ${startPointNumber}` : "Início";
        const endLabel = endPointNumber ? `Fim · ${endPointNumber}` : "Fim";
        const manualRouteMarkers: import("leaflet").Marker[] = [];
        if (start) {
          const startMarker = leaflet
            .marker(start, {
              interactive: false,
              zIndexOffset: 650,
              icon: leaflet.divIcon({
                className: "gps-route-marker gps-manual-route-marker gps-manual-route-start-marker",
                html: `<span style="--manual-route-color:${color}">${startLabel}</span>`,
                iconSize: [startPointNumber ? 74 : 52, 28],
                iconAnchor: [startPointNumber ? 37 : 26, 14]
              })
            })
            .bindTooltip(
              tooltipText(
                `Rota manual · ${manualRoute.name} · início${departureCopy(manualRoute.setup.departureTime)}${startPoint ? ` · ${startPoint.name}` : " · início do traçado"}`
              )
            )
          if (!hiddenManualRouteIdSetRef.current.has(manualRoute.id)) {
            startMarker.addTo(activeMap);
          }
          manualRouteMarkers.push(startMarker);
        }
        if (destination) {
          const destinationMarker = leaflet
            .marker(destination, {
              interactive: false,
              zIndexOffset: 650,
              icon: leaflet.divIcon({
                className: "gps-route-marker gps-manual-route-marker gps-manual-route-destination-marker",
                html: `<span style="--manual-route-color:${color}">${endLabel}</span>`,
                iconSize: [endPointNumber ? 68 : 58, 28],
                iconAnchor: [endPointNumber ? 34 : 29, 14]
              })
            })
            .bindTooltip(
              tooltipText(
                `Rota manual · ${manualRoute.name} · fim${arrivalCopy(manualRoute.setup.arrivalTime)}${endPoint ? ` · ${endPoint.name}` : " · fim do traçado"}`
              )
            )
          if (!hiddenManualRouteIdSetRef.current.has(manualRoute.id)) {
            destinationMarker.addTo(activeMap);
          }
          manualRouteMarkers.push(destinationMarker);
        }
        manualRouteMarkersRef.current[manualRoute.id] = manualRouteMarkers;
      });

      const firstSegment = visibleRouteSegments.at(0);
      const lastSegment = visibleRouteSegments.at(-1);
      const firstSegmentIndex = firstSegment?.index ?? 0;
      const lastSegmentIndex = lastSegment?.index ?? 0;
      const firstSegmentLabel =
        segmentDisplayLabels[firstSegmentIndex] ?? routeSegmentLabel(firstSegmentIndex);
      const lastSegmentLabel =
        segmentDisplayLabels[lastSegmentIndex] ?? routeSegmentLabel(lastSegmentIndex);
      const firstPoint = gpxCoordinates.at(0);
      const lastPoint = gpxCoordinates.at(-1);
      if (firstPoint) {
        const marker = leaflet
          .marker(firstPoint, {
            interactive: false,
            icon: leaflet.divIcon({
              className: "gps-route-marker gps-start-marker has-route-segment",
              html: `<span style="--route-point-color:${routeSegmentColor(firstSegment?.index ?? 0, segmentColors)}">Início</span>`,
              iconSize: [58, 30],
              iconAnchor: [29, 15]
            })
          })
          .bindTooltip(
            tooltipText(
              `Início do arquivo GPX · ${firstSegmentLabel}${departureCopy(segmentDetails[firstSegmentIndex]?.departureTime)}`
            )
          );
        if (!hiddenRouteSegmentIndexSetRef.current.has(firstSegmentIndex)) {
          marker.addTo(activeMap);
        }
        routeBoundaryMarkersRef.current.push({ segmentIndex: firstSegmentIndex, marker });
      }
      if (lastPoint) {
        const marker = leaflet
          .marker(lastPoint, {
            interactive: false,
            icon: leaflet.divIcon({
              className: "gps-route-marker gps-end-marker has-route-segment",
              html: `<span style="--route-point-color:${routeSegmentColor(lastSegment?.index ?? 0, segmentColors)}">Fim</span>`,
              iconSize: [46, 30],
              iconAnchor: [23, 15]
            })
          })
          .bindTooltip(
            tooltipText(
              `Fim do arquivo GPX · ${lastSegmentLabel}${arrivalCopy(segmentDetails[lastSegmentIndex]?.arrivalTime)}`
            )
          );
        if (!hiddenRouteSegmentIndexSetRef.current.has(lastSegmentIndex)) {
          marker.addTo(activeMap);
        }
        routeBoundaryMarkersRef.current.push({ segmentIndex: lastSegmentIndex, marker });
      }

      route.waypoints.forEach((point, index) => {
        const stepCount = pointStepCounts[point.id] ?? 0;
        const editedPosition = pointPositionEditsRef.current[point.id];
        const markerPosition = editedPosition ?? point;
        const waypointMarker = leaflet
          .marker([markerPosition.latitude, markerPosition.longitude], {
            draggable: false,
            icon: leaflet.divIcon({
              className: `gps-waypoint-marker${point.id === initialWaypointId ? " is-focused" : ""}${stepCount ? " has-steps" : ""}`,
              html: `<span>${index + 1}</span>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            })
          })
          .bindTooltip(
            tooltipText(
              `${point.name} · ${formatWaypointTime(point.time, point.description)}${stepCount ? ` · ${stepCount} etapa${stepCount === 1 ? "" : "s"}` : ""}`
            )
          )
          .addTo(activeMap);

        waypointMarkersRef.current[point.id] = waypointMarker;
        if (isEditingPointsRef.current) waypointMarker.dragging?.enable();

        waypointMarker.on("dragend", () => {
          if (!isEditingPointsRef.current) return;

          const position = waypointMarker.getLatLng();
          const nextPosition = { latitude: position.lat, longitude: position.lng };
          const originalPosition = originalPointPositionsRef.current[point.id] ?? {
            latitude: point.latitude,
            longitude: point.longitude
          };

          if (isSameCoordinate(nextPosition, originalPosition)) {
            delete pointPositionEditsRef.current[point.id];
          } else {
            pointPositionEditsRef.current[point.id] = nextPosition;
          }
          setPendingPointPositionCount(Object.keys(pointPositionEditsRef.current).length);
        });

        waypointMarker.on("click", (event) => {
          leaflet.DomEvent.stopPropagation(event.originalEvent);
          if (isDrawingManualRouteRef.current) {
            addManualRouteDraftPoint({
              latitude: point.latitude,
              longitude: point.longitude
            });
            return;
          }
          if (isEditingPointsRef.current) return;
          if (addPointModeRef.current) {
            addPointModeRef.current = false;
            setIsAddingPoint(false);
          }
          const selection = endpointMapSelectionRef.current;
          if (selection?.kind === "manual-route") {
            endpointMapSelectionRef.current = null;
            setEndpointMapSelection(null);
            onAssignManualRouteEndpointRef.current(selection.routeId, selection.side, point.id);
            return;
          }
          onEditPointRef.current(point.id);
        });
      });

      if (initialWaypoint) {
        activeMap.setView([initialWaypoint.latitude, initialWaypoint.longitude], 14);
      } else if (allCoordinates.length) {
        const bounds = leaflet.latLngBounds(allCoordinates);
        routeBoundsRef.current = bounds;
        activeMap.fitBounds(bounds, { padding: [42, 42], maxZoom: 14 });
      } else {
        activeMap.setView([35.05, 137.12], 10);
      }

      if (allCoordinates.length && !routeBoundsRef.current) {
        routeBoundsRef.current = leaflet.latLngBounds(allCoordinates);
      }
      setMapReady(true);
      if (livePositionRef.current) updateTruckMarker(livePositionRef.current);
    }

    createMap();
    return () => {
      disposed = true;
      if (map && onMapClick) map.off("click", onMapClick);
      if (map && onMapMouseMove) map.off("mousemove", onMapMouseMove);
      map?.remove();
      waypointMarkersRef.current = {};
      routeLinesRef.current = {};
      manualRouteLinesRef.current = {};
      routeBoundaryMarkersRef.current = [];
      routeEndpointMarkersRef.current = [];
      manualRouteMarkersRef.current = {};
      manualRouteDraftLineRef.current = null;
      manualRoutePreviewLineRef.current = null;
      manualRouteDraftPointLayersRef.current = [];
      if (mapRef.current === map) {
        mapRef.current = null;
        truckMarkerRef.current = null;
        accuracyCircleRef.current = null;
        routeBoundsRef.current = null;
      }
      if (mapRef.current === null) leafletRef.current = null;
      setMapReady(false);
    };
  }, [
    initialWaypoint,
    initialWaypointId,
    addManualRouteDraftPoint,
    manualRoutes,
    pointStepCounts,
    route,
    segmentColors,
    segmentDetails,
    segmentDisplayLabels,
    focusRouteSegment,
    focusManualRoute,
    updateTruckMarker,
    visibleRouteSegments
  ]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map || !mapReady) return;

    manualRouteDraftLineRef.current?.remove();
    manualRoutePreviewLineRef.current?.remove();
    manualRouteDraftPointLayersRef.current.forEach((layer) => layer.remove());
    manualRouteDraftLineRef.current = null;
    manualRoutePreviewLineRef.current = null;
    manualRouteDraftPointLayersRef.current = [];

    if (!isDrawingManualRoute || !manualRouteDraft.length) return;

    const coordinates = manualRouteDraft.map(
      (point) => [point.latitude, point.longitude] as [number, number]
    );
    let draftLine: import("leaflet").Polyline | null = null;
    if (coordinates.length > 1) {
      draftLine = leaflet
        .polyline(coordinates, {
          color: MANUAL_ROUTE_COLORS[0],
          weight: 4,
          opacity: 0.95,
          dashArray: "8 9",
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        })
        .addTo(map);
      manualRouteDraftLineRef.current = draftLine;
    }

    const lastPoint = coordinates.at(-1);
    let previewLine: import("leaflet").Polyline | null = null;
    if (lastPoint) {
      previewLine = leaflet
        .polyline([lastPoint, lastPoint], {
          color: MANUAL_ROUTE_COLORS[0],
          weight: 3,
          opacity: 0.72,
          dashArray: "4 8",
          lineCap: "round",
          interactive: false
        })
        .addTo(map);
      manualRoutePreviewLineRef.current = previewLine;
    }

    const draftPointLayers = manualRouteDraft.map((point, index) => {
      const isStart = index === 0;
      const isDestination = index === manualRouteDraft.length - 1;
      const layer = leaflet
        .circleMarker([point.latitude, point.longitude], {
          radius: isStart || isDestination ? 6 : 4,
          color: MANUAL_ROUTE_COLORS[0],
          weight: 2,
          fillColor: "#ffffff",
          fillOpacity: 1,
          interactive: false
        })
        .bindTooltip(
          isStart
            ? "Saída da rota manual"
            : isDestination
              ? "Destino atual da rota manual"
              : `Ponto ${index + 1} do traçado`
        )
        .addTo(map);
      return layer;
    });
    manualRouteDraftPointLayersRef.current = draftPointLayers;

    return () => {
      draftLine?.remove();
      previewLine?.remove();
      draftPointLayers.forEach((layer) => layer.remove());
      if (manualRouteDraftLineRef.current === draftLine) {
        manualRouteDraftLineRef.current = null;
      }
      if (manualRoutePreviewLineRef.current === previewLine) {
        manualRoutePreviewLineRef.current = null;
      }
      if (manualRouteDraftPointLayersRef.current === draftPointLayers) {
        manualRouteDraftPointLayersRef.current = [];
      }
    };
  }, [isDrawingManualRoute, manualRouteDraft, mapReady]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map || !mapReady) return;

    const selectedSegmentIndex = selectedRouteSegmentIndex;
    const hasRouteFocus = selectedSegmentIndex !== null || selectedManualRouteId !== null;
    Object.entries(routeLinesRef.current).forEach(([rawSegmentIndex, routeLine]) => {
      const segmentIndex = Number(rawSegmentIndex);
      const isVisible = !hiddenRouteSegmentIndexSet.has(segmentIndex);
      if (!isVisible) {
        routeLine.remove();
        return;
      }

      if (!map.hasLayer(routeLine)) routeLine.addTo(map);
      const isSelected = selectedSegmentIndex === segmentIndex;
      routeLine.setStyle({
        weight: !hasRouteFocus ? 5 : isSelected ? 9 : 3,
        opacity: !hasRouteFocus ? 0.9 : isSelected ? 1 : 0.2
      });
    });
    if (
      selectedSegmentIndex !== null &&
      !hiddenRouteSegmentIndexSet.has(selectedSegmentIndex)
    ) {
      routeLinesRef.current[selectedSegmentIndex]?.bringToFront();
    }

    routeBoundaryMarkersRef.current.forEach(({ segmentIndex, marker }) => {
      if (hiddenRouteSegmentIndexSet.has(segmentIndex)) {
        marker.remove();
      } else if (!map.hasLayer(marker)) {
        marker.addTo(map);
      }
    });

    routeEndpointMarkersRef.current.forEach((marker) => marker.remove());
    routeEndpointMarkersRef.current = [];

    const pointsById = new globalThis.Map(route.waypoints.map((point) => [point.id, point]));
    visibleRouteSegments.forEach((segment) => {
      if (hiddenRouteSegmentIndexSet.has(segment.index)) return;

      const endpoints = segmentEndpoints[segment.index] ?? {};
      const isSelected = selectedSegmentIndex === segment.index;
      const endpointEntries: Array<[SegmentEndpointSide, string | undefined]> = [
        ["start", endpoints.startPointId],
        ["end", endpoints.endPointId]
      ];

      endpointEntries.forEach(([side, pointId]) => {
        const assignedPoint = pointId ? pointsById.get(pointId) : undefined;
        const fallbackPoint = side === "start" ? segment.points[0] : segment.points.at(-1);
        const point = assignedPoint ?? fallbackPoint;
        if (!point || (!assignedPoint && !isSelected)) return;

        const endpointName = side === "start" ? "Início" : "Fim";
        const segmentLabel = segmentDisplayLabels[segment.index] ?? routeSegmentLabel(segment.index);
        const endpointTime =
          side === "start"
            ? departureCopy(segmentDetails[segment.index]?.departureTime)
            : arrivalCopy(segmentDetails[segment.index]?.arrivalTime);
        const label = endpointName;
        const marker = leaflet
          .marker([point.latitude, point.longitude], {
            icon: leaflet.divIcon({
              className: `gps-route-marker gps-segment-endpoint-marker gps-${side}-endpoint-marker has-route-segment${isSelected ? " is-selected-segment-endpoint" : ""}`,
              html: `<span style="--route-point-color:${routeSegmentColor(segment.index, segmentColors)}">${label}</span>`,
              iconSize: [58, 24],
              iconAnchor: [29, side === "start" ? 34 : -10]
            }),
            zIndexOffset: isSelected ? 700 : 500
          })
          .bindTooltip(
            tooltipText(`${endpointName} ${isSelected ? "da rota em primeiro plano" : "definido"} · ${segmentLabel}${endpointTime}${assignedPoint ? ` · ${assignedPoint.name}` : ""}`)
          )
          .addTo(map);
        routeEndpointMarkersRef.current.push(marker);
      });
    });

    return () => {
      routeEndpointMarkersRef.current.forEach((marker) => marker.remove());
      routeEndpointMarkersRef.current = [];
    };
  }, [hiddenRouteSegmentIndexSet, mapReady, route.waypoints, segmentColors, segmentDetails, segmentEndpoints, segmentDisplayLabels, selectedManualRouteId, selectedRouteSegmentIndex, visibleRouteSegments]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const hasRouteFocus = selectedRouteSegmentIndex !== null || selectedManualRouteId !== null;
    Object.entries(manualRouteLinesRef.current).forEach(([routeId, routeLine]) => {
      const isVisible = !hiddenManualRouteIdSet.has(routeId);
      if (!isVisible) {
        routeLine.remove();
        manualRouteMarkersRef.current[routeId]?.forEach((marker) => marker.remove());
        return;
      }

      if (!map.hasLayer(routeLine)) routeLine.addTo(map);
      manualRouteMarkersRef.current[routeId]?.forEach((marker) => {
        if (!map.hasLayer(marker)) marker.addTo(map);
      });
      const isSelected = selectedManualRouteId === routeId;
      routeLine.setStyle({
        weight: !hasRouteFocus ? 5 : isSelected ? 9 : 3,
        opacity: !hasRouteFocus ? 0.9 : isSelected ? 1 : 0.2
      });
    });

    if (
      selectedManualRouteId !== null &&
      !hiddenManualRouteIdSet.has(selectedManualRouteId)
    ) {
      manualRouteLinesRef.current[selectedManualRouteId]?.bringToFront();
    }
  }, [hiddenManualRouteIdSet, mapReady, selectedManualRouteId, selectedRouteSegmentIndex]);

  useEffect(() => {
    if (mapRef.current && mapReady) {
      const timer = window.setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 120);
      return () => window.clearTimeout(timer);
    }
  }, [mapReady, navigationMode]);

  useEffect(() => stopTracking, [stopTracking]);

  if (navigationMode) {
    return (
      <main className="gps-page is-navigation-fullscreen">
        <div className="gps-navigation-hud">
          <div className="hud-card-main">
            <div className="hud-route-badge">
              <Navigation size={15} className="gps-nav-icon-spin" />
              <span>NAVEGAÇÃO</span>
            </div>
            <div className="hud-route-title">
              <strong>{activeRouteName || "Primeira Rota"}</strong>
              <span>
                {gpsState === "tracking"
                  ? "🟢 GPS Ao Vivo"
                  : gpsState === "searching"
                    ? "🟡 Buscando sinal GPS..."
                    : `🔴 ${gpsMessage}`}
              </span>
            </div>
          </div>

          <div className="hud-controls-group">
            <button
              className="hud-button hud-layer-toggle"
              type="button"
              onClick={toggleMapLayerType}
              title="Alternar entre modo Satélite e modo Ruas"
            >
              {mapLayerType === "satellite" ? <Layers size={16} /> : <Globe size={16} />}
              {mapLayerType === "satellite" ? "Modo Ruas" : "Modo Satélite"}
            </button>
            <button
              className="hud-button hud-recenter"
              type="button"
              onClick={() => {
                if (mapRef.current && livePositionRef.current) {
                  mapRef.current.flyTo(
                    [livePositionRef.current.latitude, livePositionRef.current.longitude],
                    16
                  );
                } else {
                  centerRoute();
                }
              }}
              title="Centralizar no caminhão"
            >
              <Crosshair size={16} /> Centralizar
            </button>
            <button
              className="hud-button hud-exit"
              type="button"
              onClick={onExitNavigation || onBack}
              title="Sair da Navegação"
            >
              <X size={16} /> Sair
            </button>
          </div>
        </div>

        <section className="gps-layout">
          <div className="gps-map-panel panel">
            <div
              className={`gps-map${hasRouteFocus ? " is-focusing-route-segment" : ""}`}
              ref={mapContainerRef}
              aria-label="Mapa de Navegação GPS"
            />
          </div>
        </section>

        <div className="gps-navigation-bottom-bar">
          <button
            className="hud-exit-large-button"
            type="button"
            onClick={onExitNavigation || onBack}
          >
            <X size={18} /> Encerrar Navegação
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="gps-page">
      <header className="gps-page-header">
        <div className="gps-title-block">
          <button className="gps-back-button" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> Minhas rotas
          </button>
          <div>
            <span className="eyebrow">MODO GPS</span>
            <h1>Localização do caminhão</h1>
            <p>
              {visibleRouteSegments.length ? (
                <>Rota carregada do arquivo <strong>rota.gpx</strong></>
              ) : manualRoutes.length ? (
                "Rota manual salva neste navegador"
              ) : (
                "Desenhe uma rota manual ou carregue um arquivo GPX"
              )}
            </p>
          </div>
        </div>
        <div className="gps-header-actions">
          <button
            className={`secondary-button gps-add-point-button ${isAddingPoint ? "is-active" : ""}`}
            type="button"
            disabled={!mapReady || isEditingPoints || Boolean(endpointMapSelection) || isDrawingManualRoute}
            aria-pressed={isAddingPoint}
            onClick={toggleAddPointMode}
          >
            <Plus size={17} /> {isAddingPoint ? "Cancelar ponto" : "Adicionar ponto"}
          </button>
          <button
            className={`secondary-button gps-manual-route-button ${isDrawingManualRoute ? "is-active" : ""}`}
            type="button"
            disabled={!mapReady || isEditingPoints || Boolean(endpointMapSelection)}
            aria-pressed={isDrawingManualRoute}
            onClick={isDrawingManualRoute ? cancelManualRouteDrawing : startManualRouteDrawing}
          >
            <Route size={17} /> {isDrawingManualRoute ? "Cancelar traçado" : "Traçar rota"}
          </button>
          <button className="secondary-button gps-center-button" type="button" onClick={centerRoute}>
            <Crosshair size={17} /> Centralizar rota
          </button>
          <button
            className={`primary-button gps-track-button ${gpsState === "tracking" ? "is-tracking" : ""}`}
            type="button"
            disabled={!mapReady && gpsState !== "tracking"}
            onClick={gpsState === "tracking" || gpsState === "searching" ? stopTracking : startTracking}
          >
            {gpsState === "tracking" || gpsState === "searching" ? <Radio size={18} /> : <Satellite size={18} />}
            {gpsState === "tracking" || gpsState === "searching" ? "Parar GPS" : "Ativar GPS"}
          </button>
        </div>
      </header>

      {navigationMode && (
        <div className="gps-navigation-banner">
          <div className="gps-nav-badge">
            <Navigation size={16} className="gps-nav-icon-spin" />
            <span>MODO NAVEGAÇÃO AO VIVO</span>
          </div>
          <div className="gps-nav-info">
            <strong>Seguindo: {activeRouteName || "Primeira Rota"}</strong>
            <span>{gpsState === "tracking" ? "Sua localização está sendo atualizada no mapa em tempo real" : gpsMessage}</span>
          </div>
          <div className="gps-nav-actions">
            {livePosition && (
              <button
                className="secondary-button gps-nav-recenter"
                type="button"
                onClick={() => {
                  if (mapRef.current && livePosition) {
                    mapRef.current.flyTo([livePosition.latitude, livePosition.longitude], 16);
                  }
                }}
              >
                <Crosshair size={15} /> Centralizar caminhão
              </button>
            )}
            <button
              className="secondary-button gps-nav-exit"
              type="button"
              onClick={onExitNavigation || onBack}
            >
              <X size={15} /> Sair da navegação
            </button>
          </div>
        </div>
      )}

      <section className="gps-layout">
        {pointsPanel}
        <div className="gps-map-panel panel">
          <div className="gps-map-toolbar">
            <span className="gps-map-label">
              <Route size={15} /> {isDrawingManualRoute ? "Traçando rota manual" : "Rota estabelecida"}
            </span>
            {isAddingPoint && (
              <span className="gps-add-point-hint" role="status">
                Clique no mapa para adicionar o ponto.
              </span>
            )}
            {isDrawingManualRoute && (
              <span className="gps-manual-route-hint" role="status">
                Clique na saída, nos pontos do caminho e no destino. A linha segue a ordem dos cliques.
              </span>
            )}
            {isEditingPoints && (
              <span className="gps-edit-points-hint" role="status">
                Arraste os pontos numerados. A linha GPX não muda.
              </span>
            )}
            {endpointMapSelection && (
              <span className="gps-endpoint-selection-hint" role="status">
                {endpointMapSelection.kind === "segment"
                  ? `Clique na linha de ${segmentDisplayLabels[endpointMapSelection.segmentIndex] ?? routeSegmentLabel(endpointMapSelection.segmentIndex)} para marcar o ${endpointMapSelection.side === "start" ? "início" : "fim"}.`
                  : `Clique em um ponto numerado, na linha ou no local exato do mapa para corrigir o ${endpointMapSelection.side === "start" ? "início" : "fim"} da rota manual.`}
              </span>
            )}
            {selectedRouteSegmentIndex !== null && !endpointMapSelection && (
              <span className="gps-route-focus-hint" role="status">
                {segmentDisplayLabels[selectedRouteSegmentIndex] ?? routeSegmentLabel(selectedRouteSegmentIndex)}{segmentScheduleCopy(segmentDetails[selectedRouteSegmentIndex])} em primeiro plano — início e fim visíveis.
              </span>
            )}
            {selectedManualRoute && !endpointMapSelection && (
              <span className="gps-route-focus-hint" role="status">
                {selectedManualRoute.name}{manualRouteScheduleCopy(selectedManualRoute.setup) || " · horários ainda não definidos"} em primeiro plano.
              </span>
            )}
            <div className="gps-map-edit-controls">
              {hasRouteFocus && !isEditingPoints && !endpointMapSelection && (
                <button
                  className="gps-clear-route-focus-button"
                  type="button"
                  onClick={() => {
                    focusRouteSegment(null);
                    focusManualRoute(null);
                  }}
                >
                  <X size={14} /> Mostrar todos
                </button>
              )}
              {isDrawingManualRoute ? (
                <>
                  <button
                    className="gps-undo-manual-route-button"
                    type="button"
                    disabled={!manualRouteDraft.length}
                    onClick={undoManualRouteDraftPoint}
                  >
                    <Undo2 size={14} /> Desfazer
                  </button>
                  <button
                    className="gps-cancel-manual-route-button"
                    type="button"
                    onClick={cancelManualRouteDrawing}
                  >
                    <X size={14} /> Cancelar
                  </button>
                  <button
                    className="gps-save-manual-route-button"
                    type="button"
                    disabled={manualRouteDraft.length < 2}
                    onClick={saveManualRouteDrawing}
                  >
                    <Save size={14} /> Salvar rota
                  </button>
                </>
              ) : isEditingPoints ? (
                <>
                  <button className="gps-cancel-points-button" type="button" onClick={cancelPointEditing}>
                    <X size={14} /> Cancelar
                  </button>
                  <button
                    className="gps-save-points-button"
                    type="button"
                    onClick={savePointEditing}
                    disabled={!pendingPointPositionCount}
                  >
                    <Save size={14} /> {pendingPointPositionCount ? `Salvar (${pendingPointPositionCount})` : "Salvar"}
                  </button>
                </>
              ) : endpointMapSelection ? (
                <button
                  className="gps-cancel-points-button"
                  type="button"
                  onClick={clearEndpointMapSelection}
                >
                  <X size={14} /> Cancelar marcação
                </button>
              ) : (
                <button
                  className="gps-edit-points-button"
                  type="button"
                  disabled={!mapReady}
                  onClick={startPointEditing}
                >
                  <Pencil size={14} /> Editar pontos
                </button>
              )}
            </div>
            <span className="gps-map-points">
              {isDrawingManualRoute
                ? `${manualRouteDraft.length} ${manualRouteDraft.length === 1 ? "ponto" : "pontos"} no traçado`
                : visibleRouteSegments.length
                  ? `${route.totalTrackPoints.toLocaleString("pt-BR")} pontos GPX${manualRoutePointCount ? ` + ${manualRoutePointCount} manuais` : ""}`
                  : `${manualRoutePointCount.toLocaleString("pt-BR")} pontos manuais`}
            </span>
          </div>
          <div
            className={`gps-map${isAddingPoint ? " is-adding-point" : ""}${isDrawingManualRoute ? " is-drawing-manual-route" : ""}${isEditingPoints ? " is-editing-points" : ""}${endpointMapSelection ? " is-selecting-endpoint" : ""}${hasRouteFocus ? " is-focusing-route-segment" : ""}`}
            ref={mapContainerRef}
            aria-label="Mapa da rota GPS"
          />
          {!hasRoute && !isDrawingManualRoute && (
            <div className="gps-map-empty">
              <TriangleAlert size={20} />
              <span>Não há uma trilha carregada. Use <strong>Traçar rota</strong> para desenhar o caminho manualmente.</span>
            </div>
          )}
          <div className={`gps-live-status gps-${gpsState}`}>
            <span>{gpsState === "tracking" && <i />}</span>
            <div>
              <strong>{gpsState === "tracking" ? "GPS ao vivo" : "Status do GPS"}</strong>
              <p>{gpsMessage}</p>
            </div>
          </div>
        </div>

        <aside className="gps-info-panel panel">
          <div className="gps-info-heading">
            <div className="gps-info-icon"><Navigation size={18} /></div>
            <div>
              <h2>Meu caminhão</h2>
              <p>A posição vem do dispositivo com esta tela aberta.</p>
            </div>
          </div>

          {livePosition ? (
            <div className="gps-position-card">
              <div>
                <span>Última atualização</span>
                <strong>{livePosition.updatedAt}</strong>
              </div>
              <div>
                <span>Precisão</span>
                <strong>± {Math.round(livePosition.accuracy)} m</strong>
              </div>
              <div className="gps-coordinate-row">
                <span>Latitude</span>
                <strong>{livePosition.latitude.toFixed(5)}</strong>
                <span>Longitude</span>
                <strong>{livePosition.longitude.toFixed(5)}</strong>
              </div>
            </div>
          ) : (
            <div className="gps-notice">
              <MapPinned size={18} />
              <p>Toque em <strong>Ativar GPS</strong> e permita a localização para exibir o caminhão no mapa.</p>
            </div>
          )}

          <div className="gps-route-summary">
            <div>
              <span>Trajeto exibido</span>
              <strong>
                {visibleRouteSegments.length
                  ? `${route.renderedTrackPoints.toLocaleString("pt-BR")} pontos GPX${manualRoutePointCount ? ` + ${manualRoutePointCount} manuais` : ""}`
                  : `${manualRoutePointCount.toLocaleString("pt-BR")} pontos manuais`}
              </strong>
            </div>
            <div>
              <span>Marcadores da rota</span>
              <strong>
                {route.waypoints.length} pontos
                {manualRoutes.length ? ` + ${manualRoutes.length} ${manualRoutes.length === 1 ? "rota manual" : "rotas manuais"}` : ""}
              </strong>
            </div>
          </div>

          {(visibleRouteSegments.length > 0 || manualRoutes.length > 0) && (
            <section className="gps-segment-legend" aria-labelledby="gps-segment-legend-title">
              <div className="gps-segment-legend-heading">
                <h3 id="gps-segment-legend-title">Trechos e rotas</h3>
                <span>
                  {visibleRouteSegments.length} {visibleRouteSegments.length === 1 ? "trecho" : "trechos"}
                  {manualRoutes.length
                    ? ` + ${manualRoutes.length} ${manualRoutes.length === 1 ? "rota manual" : "rotas manuais"}`
                    : ""}
                </span>
              </div>
              <p>
                Use o olho para exibir ou ocultar. Nos trechos GPX, defina início e fim; nas rotas
                desenhadas, escolha os pontos de início e fim e seus horários.
              </p>
              <ol>
                {sortedVisibleRouteSegments.map((segment) => {
                  const endpoints = segmentEndpoints[segment.index] ?? {};
                  const isSegmentVisible = !hiddenRouteSegmentIndexSet.has(segment.index);
                  const isMarkingStart =
                    endpointMapSelection?.kind === "segment" &&
                    endpointMapSelection.segmentIndex === segment.index &&
                    endpointMapSelection.side === "start";
                  const isMarkingEnd =
                    endpointMapSelection?.kind === "segment" &&
                    endpointMapSelection.segmentIndex === segment.index &&
                    endpointMapSelection.side === "end";

                  return (
                    <li
                      className={`gps-recording-item${isSegmentVisible ? " is-visible" : ""}${selectedRouteSegmentIndex === segment.index ? " is-selected" : ""}`}
                      key={segment.index}
                    >
                      <div className="gps-segment-item-header">
                        <label className="gps-segment-color-control">
                          <span className="visually-hidden">Escolher a cor de {segmentDisplayLabels[segment.index] ?? routeSegmentLabel(segment.index)}</span>
                          <input
                            type="color"
                            value={routeSegmentColor(segment.index, segmentColors)}
                            onChange={(event) => onChangeSegmentColor(segment.index, event.target.value)}
                          />
                        </label>
                        <button
                          className="gps-segment-visibility-toggle"
                          type="button"
                          aria-pressed={isSegmentVisible}
                          onClick={() => toggleRouteSegmentVisibility(segment.index)}
                        >
                          {isSegmentVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                          <span>
                            <strong>{segmentDisplayLabels[segment.index] ?? routeSegmentLabel(segment.index)}</strong>
                            <small>{isSegmentVisible ? "Exibido no mapa" : "Oculto no mapa"}</small>
                          </span>
                        </button>
                      </div>
                      <span className="gps-segment-recording-time">
                        Gravação: {formatRecordingTime(segment.timing.startTime)} → {formatRecordingTime(segment.timing.endTime)}
                      </span>
                      <SegmentDetailsForm
                        key={`${segment.index}:${segmentDetails[segment.index]?.name ?? ""}:${segmentDetails[segment.index]?.departureTime ?? ""}:${segmentDetails[segment.index]?.arrivalTime ?? ""}`}
                        segmentIndex={segment.index}
                        detail={segmentDetails[segment.index]}
                        endpoints={endpoints}
                        waypoints={route.waypoints}
                        disabled={isEditingPoints}
                        canMarkEndpoints={mapReady && !isEditingPoints}
                        isMarkingStart={isMarkingStart}
                        isMarkingEnd={isMarkingEnd}
                        onSave={(detail) => onSaveSegmentDetails(segment.index, detail)}
                        onAssignEndpoint={(side, pointId) =>
                          onAssignSegmentEndpoint(segment.index, side, pointId)
                        }
                        onMarkEndpoint={(side) => selectSegmentEndpointOnMap(segment.index, side)}
                      />
                    </li>
                  );
                })}
                {manualRoutes.length > 0 && (
                  <li className="gps-manual-routes-label" aria-hidden="true">
                    Rotas desenhadas manualmente
                  </li>
                )}
                {sortedManualRoutes.map((manualRoute, index) => {
                  const color = manualRoute.color ?? MANUAL_ROUTE_COLORS[index % MANUAL_ROUTE_COLORS.length];
                  const isRouteVisible = !hiddenManualRouteIdSet.has(manualRoute.id);
                  const isRouteSelected = selectedManualRouteId === manualRoute.id;
                  const setup = manualRoute.setup;
                  const isMarkingStart =
                    endpointMapSelection?.kind === "manual-route" &&
                    endpointMapSelection.routeId === manualRoute.id &&
                    endpointMapSelection.side === "start";
                  const isMarkingEnd =
                    endpointMapSelection?.kind === "manual-route" &&
                    endpointMapSelection.routeId === manualRoute.id &&
                    endpointMapSelection.side === "end";

                  return (
                    <li
                      className={`gps-recording-item gps-manual-recording-item${isRouteVisible ? " is-visible" : ""}${isRouteSelected ? " is-selected" : ""}`}
                      key={manualRoute.id}
                    >
                      <div className="gps-segment-item-header">
                        <label className="gps-segment-color-control">
                          <span className="visually-hidden">Escolher a cor de {manualRoute.name}</span>
                          <input
                            type="color"
                            value={color}
                            onChange={(event) => onChangeManualRouteColor(manualRoute.id, event.target.value)}
                          />
                        </label>
                        <button
                          className="gps-segment-visibility-toggle"
                          type="button"
                          aria-pressed={isRouteVisible}
                          onClick={() => toggleManualRouteVisibility(manualRoute.id)}
                        >
                          {isRouteVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                          <span>
                            <strong>{manualRoute.name}</strong>
                            <small>{isRouteVisible ? "Exibida no mapa" : "Oculta no mapa"} · Traçado manual</small>
                          </span>
                        </button>
                      </div>
                      <span className="gps-segment-recording-time">
                        Início: {setup.departureTime || "não definido"} → Fim: {setup.arrivalTime || "não definido"}
                      </span>
                      <ManualRouteDetailsForm
                        key={`${manualRoute.id}:${manualRoute.name}:${setup.startPointId ?? ""}:${setup.endPointId ?? ""}:${setup.departureTime ?? ""}:${setup.arrivalTime ?? ""}`}
                        routeName={manualRoute.name}
                        setup={setup}
                        waypoints={route.waypoints}
                        disabled={isEditingPoints || isDrawingManualRoute}
                        canMarkEndpoints={mapReady && !isEditingPoints && !isDrawingManualRoute}
                        isMarkingStart={isMarkingStart}
                        isMarkingEnd={isMarkingEnd}
                        onMarkEndpoint={(side) => selectManualRouteEndpointOnMap(manualRoute.id, side)}
                        onSave={(name, nextSetup) =>
                          onSaveManualRouteSetup(manualRoute.id, name, nextSetup)
                        }
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <p className="gps-privacy-note">
            O app não envia sua posição para outra pessoa. Para rastreamento remoto, será preciso conectar um GPS/telefone do caminhão a uma base de dados.
          </p>
        </aside>
      </section>
    </main>
  );
}
