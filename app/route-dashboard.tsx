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
import { useEffect, useMemo, useState } from "react";
import { GpsTrackingView } from "./gps-tracking-view";
import type { GpxRouteData } from "../lib/gpx-route";

type StopType = "stage" | "taiki" | "lunch";

type RouteStop = {
  id: string;
  type: StopType;
  label: string;
  stageNumber?: string;
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
};

type RouteStatus = "active" | "waiting" | "done";

const STORAGE_KEY = "roteiro-truck-routes-v1";
const FIXED_POINTS_KEY = "roteiro-truck-fixed-points-v1";
const BACKUP_VERSION = 1;

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

function isValidStop(value: unknown): value is RouteStop {
  if (!value || typeof value !== "object") return false;
  const stop = value as Partial<RouteStop>;
  return (
    typeof stop.id === "string" &&
    (stop.type === "stage" || stop.type === "taiki" || stop.type === "lunch") &&
    typeof stop.label === "string" &&
    typeof stop.start === "string" &&
    typeof stop.end === "string" &&
    (stop.stageNumber === undefined || typeof stop.stageNumber === "string")
  );
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
    stops: legacy.stops
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
    return `No Stage ${current.stageNumber || "—"} até ${current.end}`;
  }
  if (getStatus(route, nowMinutes) === "done") return "Rota finalizada";
  const next = route.stops.find((stop) => nowMinutes < toMinutes(stop.start));
  return next ? `Próximo: ${stopMeta[next.type].label} às ${next.start}` : "Em rota";
}

function waypointTimeLabel(time: string, description: string) {
  const descriptionTime = description.match(/\b(\d{2}:\d{2})(?::\d{2})?\b/)?.[1];
  return descriptionTime ?? (time ? time.slice(11, 16) : "Ponto GPS");
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

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };

    updateClock();
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const storedPoints = window.localStorage.getItem(FIXED_POINTS_KEY);
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
    const hydrationFrame = window.requestAnimationFrame(() => {
      setRoutes(initial);
      setFixedPoints(initialPoints);
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
    }
  }, [fixedPoints, ready, routes]);

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

  function openNewRoute() {
    setDraft(emptyRoute());
    setModalOpen(true);
  }

  function openEditRoute(route: TruckRoute) {
    setDraft(JSON.parse(JSON.stringify(route)));
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
      stops: draft.stops
        .map((stop) => ({
          ...stop,
          label: stop.label.trim() || stopMeta[stop.type].label,
          stageNumber: stop.stageNumber?.trim()
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

  function exportBackup() {
    const payload = {
      app: "Roteiro",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      fixedPoints,
      routes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `roteiro-backup-${localISODate()}.json`;
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

  if (viewMode === "gps") {
    return (
      <GpsTrackingView
        route={gpxRoute}
        initialWaypointId={gpsFocusPointId}
        onBack={() => {
          setViewMode("routes");
          setGpsFocusPointId(null);
        }}
      />
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
            {gpxRoute.waypoints.length > 0 && <span className="nav-count">{gpxRoute.waypoints.length}</span>}
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

            {gpxRoute.waypoints.length > 0 && (
              <div className="gpx-points-card">
                <div className="gpx-points-heading">
                  <div className="gpx-points-icon"><Satellite size={16} /></div>
                  <div>
                    <strong>Pontos da rota GPS</strong>
                    <p>{gpxRoute.waypoints.length} marcadores do arquivo rota.gpx</p>
                  </div>
                  <button type="button" onClick={() => openGps()}>
                    Ver mapa
                  </button>
                </div>
                <div className="gpx-points-list">
                  {gpxRoute.waypoints.map((point, index) => (
                    <button type="button" key={point.id} onClick={() => openGps(point.id)}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{point.name}</strong>
                        <small>{waypointTimeLabel(point.time, point.description)}</small>
                      </div>
                      <MapPin size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                  ? `Entrada — Stage ${stop.stageNumber || "—"}`
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
                              stageNumber: type === "stage" ? stop.stageNumber : undefined
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
                O backup inclui destinos, horários, stages, taikis, almoços e
                números dos caminhões.
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
