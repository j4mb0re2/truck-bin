"use client";

import {
  ArrowLeft,
  Crosshair,
  MapPinned,
  Navigation,
  Plus,
  Radio,
  Route,
  Satellite,
  TriangleAlert
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GpxCoordinate, GpxRouteData } from "../lib/gpx-route";
import {
  getRenderedRouteSegments,
  routeSegmentColor,
  routeSegmentLabel
} from "../lib/route-segment-utils";

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
  initialWaypointId,
  onAddPoint,
  onEditPoint,
  onBack
}: {
  route: GpxRouteData;
  pointStepCounts: Record<string, number>;
  pointSegmentIndexes: Record<string, number>;
  initialWaypointId: string | null;
  onAddPoint: (coordinate: GpxCoordinate) => void;
  onEditPoint: (pointId: string) => void;
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
  const addPointModeRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsMessage, setGpsMessage] = useState("GPS desligado — ative para localizar o caminhão.");
  const [livePosition, setLivePosition] = useState<LivePosition | null>(null);
  const [isAddingPoint, setIsAddingPoint] = useState(false);

  useEffect(() => {
    onAddPointRef.current = onAddPoint;
  }, [onAddPoint]);

  useEffect(() => {
    onEditPointRef.current = onEditPoint;
  }, [onEditPoint]);

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
    setIsAddingPoint((currentMode) => {
      const nextMode = !currentMode;
      addPointModeRef.current = nextMode;
      return nextMode;
    });
  }, []);

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

      map.flyTo(coordinates, Math.max(map.getZoom(), 15), { duration: 0.65 });
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
      visibleRouteSegments.forEach((segment) => {
        const coordinates = segment.points.map(
          (point) => [point.latitude, point.longitude] as [number, number]
        );
        const color = routeSegmentColor(segment.index);
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
              html: `<span style="--route-point-color:${routeSegmentColor(firstSegment?.index ?? 0)}">Início</span>`,
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
              html: `<span style="--route-point-color:${routeSegmentColor(lastSegment?.index ?? 0)}">Fim</span>`,
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
          segmentIndex === undefined ? undefined : routeSegmentColor(segmentIndex);
        const segmentLabel =
          segmentIndex === undefined ? "" : ` · ${routeSegmentLabel(segmentIndex)}`;
        const waypointMarker = leaflet
          .marker([point.latitude, point.longitude], {
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

        waypointMarker.on("click", (event) => {
          leaflet.DomEvent.stopPropagation(event.originalEvent);
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
      if (mapRef.current === map) {
        mapRef.current = null;
        truckMarkerRef.current = null;
        accuracyCircleRef.current = null;
      }
      if (mapRef.current === null) leafletRef.current = null;
      setMapReady(false);
    };
  }, [initialWaypoint, initialWaypointId, pointSegmentIndexes, pointStepCounts, route, updateTruckMarker, visibleRouteSegments]);

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
            disabled={!mapReady}
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
            <span className="gps-map-points">{route.totalTrackPoints.toLocaleString("pt-BR")} pontos GPX</span>
          </div>
          <div
            className={`gps-map${isAddingPoint ? " is-adding-point" : ""}`}
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

          {visibleRouteSegments.length > 1 && (
            <section className="gps-segment-legend" aria-labelledby="gps-segment-legend-title">
              <div className="gps-segment-legend-heading">
                <h3 id="gps-segment-legend-title">Pausas e retomadas</h3>
                <span>{visibleRouteSegments.length} trechos</span>
              </div>
              <p>As cores do mapa mudam quando o GPS voltou a gravar a rota.</p>
              <ol>
                {visibleRouteSegments.map((segment) => (
                  <li key={segment.index}>
                    <span
                      className="gps-segment-swatch"
                      style={{ backgroundColor: routeSegmentColor(segment.index) }}
                      aria-hidden="true"
                    />
                    <span>{routeSegmentLabel(segment.index)}</span>
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
