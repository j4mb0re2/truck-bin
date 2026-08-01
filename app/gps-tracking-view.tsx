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
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GpxCoordinate, GpxRouteData } from "../lib/gpx-route";
import {
  getRenderedRouteSegments,
  routeSegmentColor,
  routeSegmentLabel
} from "../lib/route-segment-utils";
import type { RouteSegmentColors } from "../lib/route-segment-utils";

type GpsState = "idle" | "searching" | "tracking" | "error";
type LivePosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  updatedAt: string;
};
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
  initialWaypointId,
  onAddPoint,
  onEditPoint,
  onSavePointPositions,
  onChangeSegmentColor,
  onBack
}: {
  route: GpxRouteData;
  pointStepCounts: Record<string, number>;
  pointSegmentIndexes: Record<string, number>;
  segmentColors: RouteSegmentColors;
  initialWaypointId: string | null;
  onAddPoint: (coordinate: GpxCoordinate) => void;
  onEditPoint: (pointId: string) => void;
  onSavePointPositions: (positions: Record<string, GpxCoordinate>) => void;
  onChangeSegmentColor: (segmentIndex: number, color: string) => void;
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
  const addPointModeRef = useRef(false);
  const isEditingPointsRef = useRef(false);
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
    addPointModeRef.current = isAddingPoint;
  }, [isAddingPoint]);

  const visibleRouteSegments = useMemo(
    () => getRenderedRouteSegments(route.segments, route.segmentTimings),
    [route.segmentTimings, route.segments]
  );
  const hasRoute = visibleRouteSegments.length > 0;
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
    if (isEditingPointsRef.current) return;

    setIsAddingPoint((currentMode) => {
      const nextMode = !currentMode;
      addPointModeRef.current = nextMode;
      return nextMode;
    });
  }, []);

  const setWaypointMarkersEditing = useCallback((editable: boolean) => {
    Object.values(waypointMarkersRef.current).forEach((marker) => {
      if (editable) marker.dragging?.enable();
      else marker.dragging?.disable();
    });
  }, []);

  const startPointEditing = useCallback(() => {
    if (!mapReady) return;

    addPointModeRef.current = false;
    setIsAddingPoint(false);
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
        if (!addPointModeRef.current) return;

        addPointModeRef.current = false;
        setIsAddingPoint(false);
        onAddPointRef.current({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng
        });
      };
      activeMap.on("click", onMapClick);

      const allCoordinates: [number, number][] = [];
      waypointMarkersRef.current = {};
      visibleRouteSegments.forEach((segment) => {
        const coordinates = segment.points.map(
          (point) => [point.latitude, point.longitude] as [number, number]
        );
        const color = routeSegmentColor(segment.index, segmentColors);
        allCoordinates.push(...coordinates);
        leaflet
          .polyline(coordinates, {
            color,
            weight: 5,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round"
          })
          .addTo(activeMap);
      });

      const firstSegment = visibleRouteSegments.at(0);
      const lastSegment = visibleRouteSegments.at(-1);
      const firstPoint = allCoordinates.at(0);
      const lastPoint = allCoordinates.at(-1);
      if (firstPoint) {
        leaflet
          .marker(firstPoint, {
            icon: leaflet.divIcon({
              className: "gps-route-marker gps-start-marker has-route-segment",
              html: `<span style="--route-point-color:${routeSegmentColor(firstSegment?.index ?? 0, segmentColors)}">Início</span>`,
              iconSize: [58, 30],
              iconAnchor: [29, 15]
            })
          })
          .bindTooltip(tooltipText(`Início do arquivo GPX · ${routeSegmentLabel(firstSegment?.index ?? 0)}`))
          .addTo(activeMap);
      }
      if (lastPoint) {
        leaflet
          .marker(lastPoint, {
            icon: leaflet.divIcon({
              className: "gps-route-marker gps-end-marker has-route-segment",
              html: `<span style="--route-point-color:${routeSegmentColor(lastSegment?.index ?? 0, segmentColors)}">Fim</span>`,
              iconSize: [46, 30],
              iconAnchor: [23, 15]
            })
          })
          .bindTooltip(tooltipText(`Fim do arquivo GPX · ${routeSegmentLabel(lastSegment?.index ?? 0)}`))
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
          segmentIndex === undefined ? "" : ` · ${routeSegmentLabel(segmentIndex)}`;
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
      map?.remove();
      waypointMarkersRef.current = {};
      if (mapRef.current === map) {
        mapRef.current = null;
        truckMarkerRef.current = null;
        accuracyCircleRef.current = null;
        routeBoundsRef.current = null;
      }
      if (mapRef.current === null) leafletRef.current = null;
      setMapReady(false);
    };
  }, [initialWaypoint, initialWaypointId, pointSegmentIndexes, pointStepCounts, route, segmentColors, updateTruckMarker, visibleRouteSegments]);

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
            <p>Rota carregada do arquivo <strong>rota.gpx</strong></p>
          </div>
        </div>
        <div className="gps-header-actions">
          <button
            className={`secondary-button gps-add-point-button ${isAddingPoint ? "is-active" : ""}`}
            type="button"
            disabled={!mapReady || isEditingPoints}
            aria-pressed={isAddingPoint}
            onClick={toggleAddPointMode}
          >
            <Plus size={17} /> {isAddingPoint ? "Cancelar ponto" : "Adicionar ponto"}
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
            <span className="gps-map-label"><Route size={15} /> Rota estabelecida</span>
            {isAddingPoint && (
              <span className="gps-add-point-hint" role="status">
                Clique no mapa para adicionar o ponto.
              </span>
            )}
            {isEditingPoints && (
              <span className="gps-edit-points-hint" role="status">
                Arraste os pontos numerados. A linha GPX não muda.
              </span>
            )}
            <div className="gps-map-edit-controls">
              {isEditingPoints ? (
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
            <span className="gps-map-points">{route.totalTrackPoints.toLocaleString("pt-BR")} pontos GPX</span>
          </div>
          <div
            className={`gps-map${isAddingPoint ? " is-adding-point" : ""}${isEditingPoints ? " is-editing-points" : ""}`}
            ref={mapContainerRef}
            aria-label="Mapa da rota GPS"
          />
          {!hasRoute && (
            <div className="gps-map-empty">
              <TriangleAlert size={20} />
              <span>Não foi possível encontrar uma trilha no arquivo rota.gpx.</span>
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
              <strong>{route.renderedTrackPoints.toLocaleString("pt-BR")} pontos otimizados</strong>
            </div>
            <div>
              <span>Marcadores da rota</span>
              <strong>{route.waypoints.length} pontos em Minhas rotas</strong>
            </div>
          </div>

          {visibleRouteSegments.length > 0 && (
            <section className="gps-segment-legend" aria-labelledby="gps-segment-legend-title">
              <div className="gps-segment-legend-heading">
                <h3 id="gps-segment-legend-title">Gravações e cores</h3>
                <span>{visibleRouteSegments.length} trechos</span>
              </div>
              <p>Defina a cor do traçado e dos pontos ligados a cada gravação.</p>
              <ol>
                {visibleRouteSegments.map((segment) => (
                  <li className="gps-recording-item" key={segment.index}>
                    <label className="gps-segment-color-control">
                      <span className="visually-hidden">Escolher a cor do trecho {segment.index + 1}</span>
                      <input
                        type="color"
                        value={routeSegmentColor(segment.index, segmentColors)}
                        onChange={(event) => onChangeSegmentColor(segment.index, event.target.value)}
                      />
                    </label>
                    <div>
                      <strong>Trecho {segment.index + 1}</strong>
                      <span>
                        Gravação: {formatRecordingTime(segment.timing.startTime)} → {formatRecordingTime(segment.timing.endTime)}
                      </span>
                    </div>
                  </li>
                ))}
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
