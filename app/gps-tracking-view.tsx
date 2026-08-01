"use client";

import {
  ArrowLeft,
  Crosshair,
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
type EndpointMapSelection = {
  segmentIndex: number;
  side: SegmentEndpointSide;
};
type ManualMapRoute = {
  id: string;
  name: string;
  points: GpxCoordinate[];
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
    return "Permita o acesso à localização para acompanhar o caminhão.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "A posição não está disponível neste momento.";
  }
  return "O GPS demorou para responder. Tente novamente em um local aberto.";
}

function tooltipText(content: string) {
  const element = document.createElement("span");
  element.textContent = content;
  return element;
}

export function GpsTrackingView({
  route,
  pointStepCounts,
  pointSegmentIndexes,
  segmentColors,
  segmentEndpoints,
  manualRoutes,
  initialWaypointId,
  onAddPoint,
  onEditPoint,
  onSavePointPositions,
  onChangeSegmentColor,
  onAssignSegmentEndpoint,
  onCreateSegmentEndpoint,
  onCreateManualRoute,
  onBack
}: {
  route: GpxRouteData;
  pointStepCounts: Record<string, number>;
  pointSegmentIndexes: Record<string, number>;
  segmentColors: RouteSegmentColors;
  segmentEndpoints: RouteSegmentEndpoints;
  manualRoutes: ManualMapRoute[];
  initialWaypointId: string | null;
  onAddPoint: (coordinate: GpxCoordinate) => void;
  onEditPoint: (pointId: string) => void;
  onSavePointPositions: (positions: Record<string, GpxCoordinate>) => void;
  onChangeSegmentColor: (segmentIndex: number, color: string) => void;
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
  onCreateManualRoute: (points: GpxCoordinate[]) => void;
  onBack: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<LeafletApi | null>(null);
  const routeBoundsRef = useRef<import("leaflet").LatLngBounds | null>(null);
  const truckMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const accuracyCircleRef = useRef<import("leaflet").Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const livePositionRef = useRef<LivePosition | null>(null);
  const onAddPointRef = useRef(onAddPoint);
  const onEditPointRef = useRef(onEditPoint);
  const onSavePointPositionsRef = useRef(onSavePointPositions);
  const onCreateSegmentEndpointRef = useRef(onCreateSegmentEndpoint);
  const addPointModeRef = useRef(false);
  const isEditingPointsRef = useRef(false);
  const isDrawingManualRouteRef = useRef(false);
  const endpointMapSelectionRef = useRef<EndpointMapSelection | null>(null);
  const routeLineClickRef = useRef(false);
  const routeLinesRef = useRef<Record<number, import("leaflet").Polyline>>({});
  const routeEndpointMarkersRef = useRef<import("leaflet").Marker[]>([]);
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
        routeSegmentDisplayLabel(segment.index, segmentEndpoints, route.waypoints)
      ])
    ) as Record<number, string>,
    [route.waypoints, segmentEndpoints, visibleRouteSegments]
  );
  const manualRoutePointCount = useMemo(
    () => manualRoutes.reduce((total, manualRoute) => total + manualRoute.points.length, 0),
    [manualRoutes]
  );
  const hasRoute = visibleRouteSegments.length > 0 || manualRoutes.length > 0;
  const initialWaypoint = route.waypoints.find((point) => point.id === initialWaypointId);

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
  }, []);

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
    manualRouteDraftRef.current = [];
    setManualRouteDraft([]);
    isDrawingManualRouteRef.current = true;
    setIsDrawingManualRoute(true);
  }, [focusRouteSegment, mapReady]);

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
      const selection = { segmentIndex, side };
      endpointMapSelectionRef.current = selection;
      setEndpointMapSelection(selection);
    },
    [focusRouteSegment, mapReady]
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
    if (!navigator.geolocation) {
      setGpsState("error");
      setGpsMessage("Este navegador não oferece suporte a GPS.");
      return;
    }

    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    setGpsState("searching");
    setGpsMessage("Procurando o sinal GPS do dispositivo…");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
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
      },
      (error) => {
        setGpsState("error");
        setGpsMessage(gpsErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3_000,
        timeout: 20_000
      }
    );
  }, [updateTruckMarker]);

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
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors"
        })
        .addTo(activeMap);

      onMapClick = (event) => {
        if (isDrawingManualRouteRef.current) {
          addManualRouteDraftPoint({
            latitude: event.latlng.lat,
            longitude: event.latlng.lng
          });
          return;
        }

        if (!addPointModeRef.current) {
          if (routeLineClickRef.current) {
            routeLineClickRef.current = false;
            return;
          }

          if (!endpointMapSelectionRef.current && !isEditingPointsRef.current) {
            focusRouteSegment(null);
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
      routeEndpointMarkersRef.current = [];
      visibleRouteSegments.forEach((segment) => {
        const coordinates = segment.points.map(
          (point) => [point.latitude, point.longitude] as [number, number]
        );
        const color = routeSegmentColor(segment.index, segmentColors);
        const segmentLabel = segmentDisplayLabels[segment.index] ?? routeSegmentLabel(segment.index);
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
          .bindTooltip(tooltipText(segmentLabel))
          .addTo(activeMap);
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
          if (!selection || selection.segmentIndex !== segment.index) return;

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

        const color = MANUAL_ROUTE_COLORS[index % MANUAL_ROUTE_COLORS.length];
        allCoordinates.push(...coordinates);
        leaflet
          .polyline(coordinates, {
            color,
            weight: 4,
            opacity: 0.95,
            dashArray: "10 8",
            lineCap: "round",
            lineJoin: "round",
            interactive: false
          })
          .bindTooltip(tooltipText(`Rota manual · ${manualRoute.name}`))
          .addTo(activeMap);

        const start = coordinates[0];
        const destination = coordinates.at(-1);
        if (start) {
          leaflet
            .marker(start, {
              interactive: false,
              icon: leaflet.divIcon({
                className: "gps-route-marker gps-manual-route-marker gps-manual-route-start-marker",
                html: `<span style="--manual-route-color:${color}">Saída</span>`,
                iconSize: [52, 28],
                iconAnchor: [26, 14]
              })
            })
            .bindTooltip(tooltipText(`Rota manual · ${manualRoute.name} · saída`))
            .addTo(activeMap);
        }
        if (destination) {
          leaflet
            .marker(destination, {
              interactive: false,
              icon: leaflet.divIcon({
                className: "gps-route-marker gps-manual-route-marker gps-manual-route-destination-marker",
                html: `<span style="--manual-route-color:${color}">Destino</span>`,
                iconSize: [58, 28],
                iconAnchor: [29, 14]
              })
            })
            .bindTooltip(tooltipText(`Rota manual · ${manualRoute.name} · destino`))
            .addTo(activeMap);
        }
      });

      const firstSegment = visibleRouteSegments.at(0);
      const lastSegment = visibleRouteSegments.at(-1);
      const firstPoint = gpxCoordinates.at(0);
      const lastPoint = gpxCoordinates.at(-1);
      if (firstPoint) {
        leaflet
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
              `Início do arquivo GPX · ${segmentDisplayLabels[firstSegment?.index ?? 0] ?? routeSegmentLabel(firstSegment?.index ?? 0)}`
            )
          )
          .addTo(activeMap);
      }
      if (lastPoint) {
        leaflet
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
              `Fim do arquivo GPX · ${segmentDisplayLabels[lastSegment?.index ?? 0] ?? routeSegmentLabel(lastSegment?.index ?? 0)}`
            )
          )
          .addTo(activeMap);
      }

      route.waypoints.forEach((point, index) => {
        const stepCount = pointStepCounts[point.id] ?? 0;
        const segmentIndex = pointSegmentIndexes[point.id];
        const segmentColor =
          segmentIndex === undefined
            ? undefined
            : routeSegmentColor(segmentIndex, segmentColors);
        const segmentLabel =
          segmentIndex === undefined
            ? ""
            : ` · ${segmentDisplayLabels[segmentIndex] ?? routeSegmentLabel(segmentIndex)}`;
        const editedPosition = pointPositionEditsRef.current[point.id];
        const markerPosition = editedPosition ?? point;
        const waypointMarker = leaflet
          .marker([markerPosition.latitude, markerPosition.longitude], {
            draggable: false,
            icon: leaflet.divIcon({
              className: `gps-waypoint-marker${segmentColor ? " has-route-segment" : ""}${point.id === initialWaypointId ? " is-focused" : ""}${stepCount ? " has-steps" : ""}`,
              html: `<span${segmentColor ? ` style="--route-point-color:${segmentColor}"` : ""}>${index + 1}</span>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            })
          })
          .bindTooltip(
            tooltipText(
              `${point.name}${segmentLabel} · ${formatWaypointTime(point.time, point.description)}${stepCount ? ` · ${stepCount} etapa${stepCount === 1 ? "" : "s"}` : ""}`
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
      routeEndpointMarkersRef.current = [];
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
    pointSegmentIndexes,
    pointStepCounts,
    route,
    segmentColors,
    segmentEndpoints,
    segmentDisplayLabels,
    focusRouteSegment,
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
    Object.entries(routeLinesRef.current).forEach(([rawSegmentIndex, routeLine]) => {
      const segmentIndex = Number(rawSegmentIndex);
      const isSelected = selectedSegmentIndex === segmentIndex;
      routeLine.setStyle({
        weight: selectedSegmentIndex === null ? 5 : isSelected ? 9 : 3,
        opacity: selectedSegmentIndex === null ? 0.9 : isSelected ? 1 : 0.2
      });
    });
    if (selectedSegmentIndex !== null) {
      routeLinesRef.current[selectedSegmentIndex]?.bringToFront();
    }

    routeEndpointMarkersRef.current.forEach((marker) => marker.remove());
    routeEndpointMarkersRef.current = [];

    const pointsById = new globalThis.Map(route.waypoints.map((point) => [point.id, point]));
    visibleRouteSegments.forEach((segment) => {
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
            tooltipText(`${endpointName} ${isSelected ? "da rota em primeiro plano" : "definido"} · ${segmentLabel}${assignedPoint ? ` · ${assignedPoint.name}` : ""}`)
          )
          .addTo(map);
        routeEndpointMarkersRef.current.push(marker);
      });
    });

    return () => {
      routeEndpointMarkersRef.current.forEach((marker) => marker.remove());
      routeEndpointMarkersRef.current = [];
    };
  }, [mapReady, route.waypoints, segmentColors, segmentEndpoints, segmentDisplayLabels, selectedRouteSegmentIndex, visibleRouteSegments]);

  useEffect(() => stopTracking, [stopTracking]);

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

      <section className="gps-layout">
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
                Clique na linha de {segmentDisplayLabels[endpointMapSelection.segmentIndex] ?? routeSegmentLabel(endpointMapSelection.segmentIndex)} para marcar o {endpointMapSelection.side === "start" ? "início" : "fim"}.
              </span>
            )}
            {selectedRouteSegmentIndex !== null && !endpointMapSelection && (
              <span className="gps-route-focus-hint" role="status">
                {segmentDisplayLabels[selectedRouteSegmentIndex] ?? routeSegmentLabel(selectedRouteSegmentIndex)} em primeiro plano — início e fim visíveis.
              </span>
            )}
            <div className="gps-map-edit-controls">
              {selectedRouteSegmentIndex !== null && !isEditingPoints && !endpointMapSelection && (
                <button
                  className="gps-clear-route-focus-button"
                  type="button"
                  onClick={() => focusRouteSegment(null)}
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
                    <Save size={14} /> Configurar rota
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
            className={`gps-map${isAddingPoint ? " is-adding-point" : ""}${isDrawingManualRoute ? " is-drawing-manual-route" : ""}${isEditingPoints ? " is-editing-points" : ""}${endpointMapSelection ? " is-selecting-segment-endpoint" : ""}${selectedRouteSegmentIndex !== null ? " is-focusing-route-segment" : ""}`}
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

          {visibleRouteSegments.length > 0 && (
            <section className="gps-segment-legend" aria-labelledby="gps-segment-legend-title">
              <div className="gps-segment-legend-heading">
                <h3 id="gps-segment-legend-title">Gravações e cores</h3>
                <span>{visibleRouteSegments.length} trechos</span>
              </div>
              <p>
                Defina a cor e escolha os pontos de início/fim. Se não existir um ponto,
                marque-o diretamente na linha da rota.
              </p>
              <ol>
                {visibleRouteSegments.map((segment) => {
                  const endpoints = segmentEndpoints[segment.index] ?? {};
                  const isMarkingStart =
                    endpointMapSelection?.segmentIndex === segment.index &&
                    endpointMapSelection.side === "start";
                  const isMarkingEnd =
                    endpointMapSelection?.segmentIndex === segment.index &&
                    endpointMapSelection.side === "end";

                  return (
                    <li
                      className={`gps-recording-item${selectedRouteSegmentIndex === segment.index ? " is-selected" : ""}`}
                      key={segment.index}
                    >
                      <label className="gps-segment-color-control">
                        <span className="visually-hidden">Escolher a cor de {segmentDisplayLabels[segment.index] ?? routeSegmentLabel(segment.index)}</span>
                        <input
                          type="color"
                          value={routeSegmentColor(segment.index, segmentColors)}
                          onChange={(event) => onChangeSegmentColor(segment.index, event.target.value)}
                        />
                      </label>
                      <div>
                        <strong>{segmentDisplayLabels[segment.index] ?? routeSegmentLabel(segment.index)}</strong>
                        <span>
                          Gravação: {formatRecordingTime(segment.timing.startTime)} → {formatRecordingTime(segment.timing.endTime)}
                        </span>
                        <div className="gps-segment-endpoint-controls">
                          <label className="gps-segment-endpoint-field">
                            <span>Início</span>
                            <select
                              value={endpoints.startPointId ?? ""}
                              disabled={isEditingPoints}
                              onChange={(event) =>
                                onAssignSegmentEndpoint(segment.index, "start", event.target.value || null)
                              }
                            >
                              <option value="">Usar início da gravação</option>
                              {route.waypoints.map((point, pointIndex) => (
                                <option key={point.id} value={point.id}>
                                  {pointIndex + 1}. {point.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className={`gps-mark-endpoint-button ${isMarkingStart ? "is-active" : ""}`}
                            type="button"
                            disabled={!mapReady || isEditingPoints}
                            aria-pressed={isMarkingStart}
                            onClick={() => selectSegmentEndpointOnMap(segment.index, "start")}
                          >
                            <MapPinned size={12} /> {isMarkingStart ? "Clique na linha" : "Marcar na linha"}
                          </button>
                          <label className="gps-segment-endpoint-field">
                            <span>Fim</span>
                            <select
                              value={endpoints.endPointId ?? ""}
                              disabled={isEditingPoints}
                              onChange={(event) =>
                                onAssignSegmentEndpoint(segment.index, "end", event.target.value || null)
                              }
                            >
                              <option value="">Usar fim da gravação</option>
                              {route.waypoints.map((point, pointIndex) => (
                                <option key={point.id} value={point.id}>
                                  {pointIndex + 1}. {point.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className={`gps-mark-endpoint-button ${isMarkingEnd ? "is-active" : ""}`}
                            type="button"
                            disabled={!mapReady || isEditingPoints}
                            aria-pressed={isMarkingEnd}
                            onClick={() => selectSegmentEndpointOnMap(segment.index, "end")}
                          >
                            <MapPinned size={12} /> {isMarkingEnd ? "Clique na linha" : "Marcar na linha"}
                          </button>
                        </div>
                      </div>
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
