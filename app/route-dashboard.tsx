"use client";

import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleParking,
  Clock3,
  Coffee,
  LayoutDashboard,
  Map,
  MapPin,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Route as RouteIcon,
  Search,
  Settings,
  Trash2,
  Truck,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type StopType = "stage" | "taiki" | "lunch";

type RouteStop = {
  id: string;
  type: StopType;
  label: string;
  stageNumber?: string;
  start: string;
  end: string;
};

type TruckRoute = {
  id: string;
  name: string;
  destination: string;
  date: string;
  departure: string;
  truck: string;
  stops: RouteStop[];
};

type RouteStatus = "active" | "waiting" | "done";
type FilterStatus = "all" | RouteStatus;

const STORAGE_KEY = "roteiro-truck-routes-v1";

const emptyRoute = (date: string): TruckRoute => ({
  id: "",
  name: "",
  destination: "",
  date,
  departure: "07:00",
  truck: "",
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
    ...route.stops.map((stop) => toMinutes(stop.end))
  );
}

function getStatus(route: TruckRoute, today: string, nowMinutes: number): RouteStatus {
  if (route.date < today) return "done";
  if (route.date > today) return "waiting";
  if (nowMinutes < toMinutes(route.departure)) return "waiting";
  if (nowMinutes >= routeEnd(route)) return "done";
  return "active";
}

function getProgress(route: TruckRoute, today: string, nowMinutes: number) {
  const start = toMinutes(route.departure);
  const end = routeEnd(route);
  if (route.date < today || nowMinutes >= end) return 100;
  if (route.date > today || nowMinutes <= start) return 0;
  return Math.min(100, Math.round(((nowMinutes - start) / (end - start)) * 100));
}

function stopStatus(
  route: TruckRoute,
  stop: RouteStop,
  today: string,
  nowMinutes: number
) {
  if (route.date < today) return "done";
  if (route.date > today) return "upcoming";
  if (nowMinutes >= toMinutes(stop.end)) return "done";
  if (nowMinutes >= toMinutes(stop.start)) return "current";
  return "upcoming";
}

function minutesToTime(minutes: number) {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function makeDemoRoutes(today: string, currentMinutes: number): TruckRoute[] {
  const base = Math.max(5 * 60, Math.min(20 * 60, currentMinutes));
  const time = (offset: number) => minutesToTime(base + offset);

  return [
    {
      id: "demo-toyota",
      name: "Toyota Motomachi",
      destination: "Toyota City, Aichi",
      date: today,
      departure: time(-240),
      truck: "42-18",
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
      destination: "Anjo, Aichi",
      date: today,
      departure: time(-70),
      truck: "18-73",
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
      destination: "Kariya, Aichi",
      date: today,
      departure: time(60),
      truck: "09-51",
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

function formatLongDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  }).format(new Date(`${date}T12:00:00`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
  })
    .format(new Date(`${date}T12:00:00`))
    .replace(".", "");
}

function getActiveLabel(route: TruckRoute, today: string, nowMinutes: number) {
  if (getStatus(route, today, nowMinutes) === "waiting") {
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
  if (getStatus(route, today, nowMinutes) === "done") return "Rota finalizada";
  const next = route.stops.find((stop) => nowMinutes < toMinutes(stop.start));
  return next ? `Próximo: ${stopMeta[next.type].label} às ${next.start}` : "Em rota";
}

export function RouteDashboard() {
  const [routes, setRoutes] = useState<TruckRoute[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [query, setQuery] = useState("");
  const [today, setToday] = useState("");
  const [nowMinutes, setNowMinutes] = useState(0);
  const [ready, setReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<TruckRoute | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setToday(localISODate(now));
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };

    updateClock();
    const currentDate = localISODate();
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    let initial: TruckRoute[];
    try {
      initial = stored
        ? JSON.parse(stored)
        : makeDemoRoutes(currentDate, currentMinutes);
    } catch {
      initial = makeDemoRoutes(currentDate, currentMinutes);
    }
    const hydrationFrame = window.requestAnimationFrame(() => {
      setRoutes(initial);
      setSelectedId(initial[0]?.id ?? "");
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
    }
  }, [ready, routes]);

  const counts = useMemo(() => {
    return routes.reduce(
      (acc, route) => {
        acc[getStatus(route, today, nowMinutes)] += 1;
        return acc;
      },
      { active: 0, waiting: 0, done: 0 }
    );
  }, [routes, today, nowMinutes]);

  const filteredRoutes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return routes
      .filter((route) => route.date === today)
      .filter(
        (route) =>
          filter === "all" || getStatus(route, today, nowMinutes) === filter
      )
      .filter(
        (route) =>
          !normalized ||
          route.name.toLocaleLowerCase("pt-BR").includes(normalized) ||
          route.destination.toLocaleLowerCase("pt-BR").includes(normalized)
      )
      .sort((a, b) => a.departure.localeCompare(b.departure));
  }, [filter, nowMinutes, query, routes, today]);

  const selectedRoute =
    routes.find((route) => route.id === selectedId) ?? filteredRoutes[0];

  function openNewRoute() {
    setDraft(emptyRoute(today || localISODate()));
    setModalOpen(true);
  }

  function openEditRoute(route: TruckRoute) {
    setDraft(JSON.parse(JSON.stringify(route)));
    setModalOpen(true);
  }

  function saveRoute(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !draft.name.trim() || !draft.destination.trim()) return;
    const cleaned = {
      ...draft,
      id: draft.id || cryptoId(),
      name: draft.name.trim(),
      destination: draft.destination.trim(),
      truck: draft.truck.trim(),
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
            <LayoutDashboard size={19} />
            Visão geral
          </button>
          <button className="nav-item" type="button">
            <Map size={19} />
            Minhas rotas
            <span className="nav-count">{routes.length}</span>
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="today-mini">
          <div className="today-mini-icon">
            <CalendarDays size={18} />
          </div>
          <div>
            <span>Hoje</span>
            <strong>{today ? formatShortDate(today) : "—"}</strong>
          </div>
        </div>
        <button className="nav-item" type="button">
          <Settings size={19} />
          Configurações
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
            <div className="date-pill">
              <CalendarDays size={17} />
              <span>{today ? formatLongDate(today) : "Carregando..."}</span>
              <ChevronDown size={15} />
            </div>
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
              <span>Rotas de hoje</span>
              <strong>{routes.filter((route) => route.date === today).length}</strong>
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
                <h2>Rotas de hoje</h2>
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

            <div className="filter-tabs">
              {([
                ["all", "Todas"],
                ["active", "Em andamento"],
                ["waiting", "Aguardando"],
                ["done", "Concluídas"]
              ] as [FilterStatus, string][]).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  {value !== "all" && (
                    <span>{counts[value]}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="route-list">
              {!ready ? (
                <>
                  <div className="route-skeleton" />
                  <div className="route-skeleton" />
                  <div className="route-skeleton" />
                </>
              ) : filteredRoutes.length ? (
                filteredRoutes.map((route) => {
                  const status = getStatus(route, today, nowMinutes);
                  const progress = getProgress(route, today, nowMinutes);
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
                          {route.destination}
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
                          {getActiveLabel(route, today, nowMinutes)}
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
                today={today}
                nowMinutes={nowMinutes}
                onEdit={() => openEditRoute(selectedRoute)}
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
    </div>
  );
}

function RouteDetail({
  route,
  today,
  nowMinutes,
  onEdit,
  onDelete
}: {
  route: TruckRoute;
  today: string;
  nowMinutes: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = getStatus(route, today, nowMinutes);
  const progress = getProgress(route, today, nowMinutes);

  return (
    <div className="detail-content">
      <div className="detail-heading">
        <div>
          <span className={`status-badge ${statusCopy[status].className}`}>
            {status === "active" && <i />}
            {statusCopy[status].label}
          </span>
          <h2>{route.name}</h2>
          <p><MapPin size={14} /> {route.destination}</p>
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

      <div className="detail-metrics">
        <div>
          <span><Clock3 size={15} /> Partida</span>
          <strong>{route.departure}</strong>
        </div>
        <div>
          <span><Truck size={15} /> Caminhão</span>
          <strong>{route.truck || "—"}</strong>
        </div>
        <div>
          <span><CalendarDays size={15} /> Data</span>
          <strong>{formatShortDate(route.date)}</strong>
        </div>
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

      <div className="timeline-header">
        <h3>Linha do tempo</h3>
        <span>{route.stops.length + 1} etapas</span>
      </div>

      <div className="timeline">
        <TimelineItem
          icon={Truck}
          color="dark"
          title="Saída"
          subtitle="Início da rota"
          time={route.departure}
          endTime=""
          state={
            route.date < today || nowMinutes >= toMinutes(route.departure)
              ? "done"
              : "upcoming"
          }
          isLast={route.stops.length === 0}
        />
        {route.stops.map((stop, index) => {
          const meta = stopMeta[stop.type];
          return (
            <TimelineItem
              key={stop.id}
              icon={meta.icon}
              color={meta.color}
              title={
                stop.type === "stage"
                  ? `Stage ${stop.stageNumber || "—"}`
                  : meta.label
              }
              subtitle={stop.label}
              time={stop.start}
              endTime={stop.end}
              state={stopStatus(route, stop, today, nowMinutes)}
              isLast={index === route.stops.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}

function TimelineItem({
  icon: Icon,
  color,
  title,
  subtitle,
  time,
  endTime,
  state,
  isLast
}: {
  icon: typeof Truck;
  color: string;
  title: string;
  subtitle: string;
  time: string;
  endTime: string;
  state: "done" | "current" | "upcoming";
  isLast: boolean;
}) {
  return (
    <div className={`timeline-item timeline-${state}`}>
      <div className="timeline-rail">
        <span className={`timeline-icon icon-${color}`}>
          {state === "done" ? <Check size={16} strokeWidth={2.8} /> : <Icon size={16} />}
        </span>
        {!isLast && <i />}
      </div>
      <div className="timeline-copy">
        <div>
          <strong>{title}</strong>
          {state === "current" && <span className="now-tag">AGORA</span>}
          <p>{subtitle}</p>
        </div>
        <time>
          {time}
          {endTime && <><span>—</span>{endTime}</>}
        </time>
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
            <p>Preencha o destino e monte as etapas do dia.</p>
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
                  <p>Dados principais do deslocamento</p>
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
                <label className="field field-wide">
                  <span>Destino</span>
                  <div className="input-icon">
                    <MapPin size={16} />
                    <input
                      required
                      value={draft.destination}
                      onChange={(event) => update("destination", event.target.value)}
                      placeholder="Cidade ou endereço da fábrica"
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Data</span>
                  <input
                    type="date"
                    required
                    value={draft.date}
                    onChange={(event) => update("date", event.target.value)}
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
                  <span>Nº do caminhão <em>opcional</em></span>
                  <input
                    value={draft.truck}
                    onChange={(event) => update("truck", event.target.value)}
                    placeholder="Ex.: 42-18"
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
