"use client";

import {
  ArrowLeft,
  Crosshair,
  MapPinned,
  Navigation,
  Radio,
  Route,
  Satellite,
  TriangleAlert
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GpxRouteData } from "../lib/gpx-route";

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

export function GpsTrackingView({
  route,
  pointStepCounts,
  initialWaypointId,
  onBack
}: {
  route: GpxRouteData;
  pointStepCounts: Record<string, number>;
  initialWaypointId: string | null;
  onBack: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<LeafletApi | null>(null);
  const routeBoundsRef = useRef<import("leaflet").LatLngBounds | null>(null);
  const truckMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const accuracyCircleRef = useRef<import("leaflet").Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsMessage, setGpsMessage] = useState("GPS desligado — ative para localizar o caminhão.");
  const [livePosition, setLivePosition] = useState<LivePosition | null>(null);

  const hasRoute = route.segments.some((segment) => segment.length > 1);
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

  const updateTruckMarker = useCallback((position: GeolocationPosition) => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map) return;

    const { latitude, longitude, accuracy } = position.coords;
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
  }, []);

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
        updateTruckMarker(position);
        setLivePosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: new Date(position.timestamp).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          })
        });
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

    async function createMap() {
      const leaflet = await import("leaflet");
      if (disposed || !mapContainerRef.current) return;

      leafletRef.current = leaflet;
      const map = leaflet.map(mapContainerRef.current, {
        zoomControl: false,
        preferCanvas: true
      });
      mapRef.current = map;
      leaflet.control.zoom({ position: "bottomright" }).addTo(map);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors"
        })
        .addTo(map);

      const allCoordinates: [number, number][] = [];
      route.segments.forEach((segment) => {
        const coordinates = segment.map(
          (point) => [point.latitude, point.longitude] as [number, number]
        );
        if (coordinates.length < 2) return;
        allCoordinates.push(...coordinates);
        leaflet
          .polyline(coordinates, {
            color: "#e76f32",
            weight: 5,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round"
          })
          .addTo(map);
      });

      const firstPoint = allCoordinates.at(0);
      const lastPoint = allCoordinates.at(-1);
      if (firstPoint) {
        leaflet
          .marker(firstPoint, {
            icon: leaflet.divIcon({
              className: "gps-route-marker gps-start-marker",
              html: "<span>Início</span>",
              iconSize: [58, 30],
              iconAnchor: [29, 15]
            })
          })
          .bindTooltip("Início do arquivo GPX")
          .addTo(map);
      }
      if (lastPoint) {
        leaflet
          .marker(lastPoint, {
            icon: leaflet.divIcon({
              className: "gps-route-marker gps-end-marker",
              html: "<span>Fim</span>",
              iconSize: [46, 30],
              iconAnchor: [23, 15]
            })
          })
          .bindTooltip("Fim do arquivo GPX")
          .addTo(map);
      }

      route.waypoints.forEach((point, index) => {
        const stepCount = pointStepCounts[point.id] ?? 0;
        leaflet
          .marker([point.latitude, point.longitude], {
            icon: leaflet.divIcon({
              className: `gps-waypoint-marker${point.id === initialWaypointId ? " is-focused" : ""}${stepCount ? " has-steps" : ""}`,
              html: `<span>${index + 1}</span>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            })
          })
          .bindTooltip(
            `${point.name} · ${formatWaypointTime(point.time, point.description)}${stepCount ? ` · ${stepCount} etapa${stepCount === 1 ? "" : "s"}` : ""}`
          )
          .addTo(map);
      });

      if (initialWaypoint) {
        map.setView([initialWaypoint.latitude, initialWaypoint.longitude], 14);
      } else if (allCoordinates.length) {
        const bounds = leaflet.latLngBounds(allCoordinates);
        routeBoundsRef.current = bounds;
        map.fitBounds(bounds, { padding: [42, 42], maxZoom: 14 });
      } else {
        map.setView([35.05, 137.12], 10);
      }

      if (allCoordinates.length && !routeBoundsRef.current) {
        routeBoundsRef.current = leaflet.latLngBounds(allCoordinates);
      }
      setMapReady(true);
    }

    createMap();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      setMapReady(false);
    };
  }, [initialWaypoint, initialWaypointId, pointStepCounts, route]);

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
            <span className="gps-map-points">{route.totalTrackPoints.toLocaleString("pt-BR")} pontos GPX</span>
          </div>
          <div className="gps-map" ref={mapContainerRef} aria-label="Mapa da rota GPS" />
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
              <span>Marcadores do arquivo</span>
              <strong>{route.waypoints.length} pontos em Minhas rotas</strong>
            </div>
          </div>

          <p className="gps-privacy-note">
            O app não envia sua posição para outra pessoa. Para rastreamento remoto, será preciso conectar um GPS/telefone do caminhão a uma base de dados.
          </p>
        </aside>
      </section>
    </main>
  );
}
