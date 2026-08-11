import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import {
  filterCatalogItems,
  fleetCategories,
  openRosterWorkspace,
  WorkspaceCommandError,
  type CatalogItemReadModel,
  type FleetCategory,
  type FleetElementReadModel,
  type RosterWorkspaceDependencies,
  type RosterWorkspaceExecution,
  type RosterInstanceReadModel,
  type RosterWorkspaceReadModel,
  type RosterWorkspaceSession,
} from "../application/rosters/workspace";
import {
  ShipEditorCommandError,
  type FleetDoctrineCommand,
  type ShipEditorCommand,
  type ShipEditorReadModel,
  type ShipEditorReadyReadModel,
} from "../application/rosters/ship-editor";
import { orbatCardFor } from "../app/orbatCards";
import { useDocumentTitle } from "../app/useDocumentTitle";
import { EyeIcon } from "../ui/EyeIcon";
import { FleetDoctrinePanel } from "../ui/FleetDoctrine";
import { OrbatPageIcon } from "../ui/OrbatPageIcon";
import { ShipOrbatPageDialog, ShipProfileDialog } from "../ui/ProfileDialog";
import { ShipEditorShell } from "../ui/ShipEditorShell";

const rosterIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/u);

type RouteState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly session: RosterWorkspaceSession;
      readonly model: RosterWorkspaceReadModel;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "error" };

type WorkspaceView = "catalog" | "composition" | "context";
type ContextOrigin = { readonly view: "catalog" | "composition"; readonly elementId: string };
type ProfilePreview = {
  readonly name: string;
  readonly model: ShipEditorReadyReadModel;
};
type OrbatPreview = { readonly imageUrl: string; readonly name: string };

function shipImageSearchUrl(name: string) {
  const search = new URLSearchParams({ q: `${name} Dystopian Wars`, tbm: "isch" });
  return `https://www.google.com/search?${search.toString()}`;
}

export function RosterWorkspaceRoute({
  dependencies,
}: {
  readonly dependencies: RosterWorkspaceDependencies;
}) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const parsedRosterId = rosterIdSchema.safeParse(params.rosterId);
  const rosterId = parsedRosterId.success ? parsedRosterId.data : null;
  const [state, setState] = useState<RouteState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FleetCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [catalogTargetId, setCatalogTargetId] = useState<string | null>(null);
  const [editorInstanceId, setEditorInstanceId] = useState<string | null>(null);
  const [contextOrigin, setContextOrigin] = useState<ContextOrigin | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("composition");
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [draggedDefinitionId, setDraggedDefinitionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const [issueReturnId, setIssueReturnId] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState<ProfilePreview | null>(null);
  const [orbatPreview, setOrbatPreview] = useState<OrbatPreview | null>(null);
  const commandInFlight = useRef(false);
  const title = state.kind === "ready" ? state.model.roster.name : "Состав флота";
  const direct = directEditorLink(location.search);
  const directMode = direct?.mode ?? null;
  const directRuleId = direct?.ruleId ?? null;
  const directShipId = direct?.shipId ?? null;
  const directFocusKey = directMode && directShipId ? `${directMode}:${directShipId}` : null;
  const handledDirectFocusKey = useRef<string | null>(null);
  useDocumentTitle(title);

  useEffect(() => {
    let active = true;
    if (!rosterId) return () => undefined;
    void openRosterWorkspace(rosterId, dependencies).then(
      (session) => {
        if (active)
          setState(
            session ? { kind: "ready", session, model: session.model } : { kind: "missing" },
          );
      },
      () => {
        if (active) setState({ kind: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [dependencies, rosterId]);

  useEffect(() => {
    if (!directRuleId) return;
    const search = new URLSearchParams(location.search);
    search.delete("rule");
    void navigate(
      { pathname: location.pathname, search: search.size ? `?${search.toString()}` : "" },
      { replace: true },
    );
  }, [directRuleId, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!directFocusKey) {
      handledDirectFocusKey.current = null;
      return;
    }
    if (state.kind !== "ready") return;
    if (handledDirectFocusKey.current === directFocusKey) return;
    handledDirectFocusKey.current = directFocusKey;
    const frame = requestAnimationFrame(() => {
      document.getElementById("ship-editor-title")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [directFocusKey, state.kind]);

  if (!parsedRosterId.success || state.kind === "missing") return <InvalidRoster />;
  if (state.kind === "loading") return <LoadingWorkspace />;
  if (state.kind === "error") return <UnavailableWorkspace />;

  const { model, session } = state;
  const directInstance =
    direct?.mode === "instance"
      ? (model.elements
          .flatMap((element) => element.instances)
          .find((candidate) => candidate.id === direct.shipId) ?? null)
      : null;
  const resolvedSelectedId =
    direct?.mode === "preview" ? direct.shipId : (directInstance?.definitionId ?? selectedId);
  const resolvedEditorInstanceId = directInstance?.id ?? editorInstanceId;
  const resolvedActiveView: WorkspaceView = direct ? "context" : activeView;
  const filtered = filterCatalogItems(model.catalog, query, category).filter(
    (item) =>
      !catalogTargetId ||
      item.eligibleTargets.some((target) => target.elementInstanceId === catalogTargetId),
  );
  const selected = model.catalog.find((item) => item.id === resolvedSelectedId) ?? null;

  async function execute(
    command: Parameters<RosterWorkspaceSession["execute"]>[0],
    success: string,
    focusId?: string,
    afterSuccess?: (result: RosterWorkspaceExecution) => void,
  ): Promise<RosterWorkspaceExecution | null> {
    if (commandInFlight.current) return null;
    commandInFlight.current = true;
    let busyShown = false;
    const busyTimer = window.setTimeout(() => {
      busyShown = true;
      setBusy(true);
    }, 100);
    setCommandError(null);
    try {
      const result = await session.executeDetailed(command);
      afterSuccess?.(result);
      setState({ kind: "ready", session, model: result.model });
      const refreshedEditor =
        "groupId" in command || command.type === "set-model-quantity"
          ? session.editor(resolvedEditorInstanceId, selected?.id ?? null)
          : null;
      setAnnouncement(
        refreshedEditor?.dataState === "ready"
          ? `${success} Итого ${refreshedEditor.totalPoints} Points. Обязательные ${refreshedEditor.mandatory.selected} из ${refreshedEditor.mandatory.required}.`
          : success,
      );
      if (focusId)
        requestAnimationFrame(() =>
          document.getElementById(focusId)?.focus({ preventScroll: true }),
        );
      return result;
    } catch (error) {
      setCommandError(
        error instanceof WorkspaceCommandError || error instanceof ShipEditorCommandError
          ? error.message
          : "Команду не удалось выполнить. Локальный состав не изменён.",
      );
      return null;
    } finally {
      window.clearTimeout(busyTimer);
      commandInFlight.current = false;
      if (busyShown) setBusy(false);
    }
  }

  function openPreview(item: CatalogItemReadModel) {
    setContextOrigin({ view: "catalog", elementId: `catalog-item-${safeId(item.id)}` });
    setSelectedId(item.id);
    const preferredTarget = item.eligibleTargets.find(
      (target) => target.elementInstanceId === catalogTargetId,
    );
    setSelectedTarget(
      preferredTarget?.elementInstanceId ??
        (item.eligibleTargets.length === 1 ? item.eligibleTargets[0]!.elementInstanceId : ""),
    );
    setCommandError(null);
    setEditorInstanceId(null);
    setActiveView("context");
    if (session.editor(null, item.id))
      requestAnimationFrame(() => document.getElementById("ship-editor-title")?.focus());
  }

  function openShipProfile(name: string, editor: ShipEditorReadModel | null) {
    if (editor?.dataState !== "ready") return;
    setOrbatPreview(null);
    setProfilePreview({
      name,
      model: editor,
    });
  }

  function openShipOrbat(name: string, imageUrl: string) {
    setProfilePreview(null);
    setOrbatPreview({ imageUrl, name });
  }

  async function addSelected() {
    if (!selected) return;
    await execute(
      {
        type: "add",
        definitionId: selected.id,
        ...(selectedTarget ? { targetElementInstanceId: selectedTarget } : {}),
      },
      `${selected.name} добавлен в состав.`,
      undefined,
      (result) => {
        if (!result.createdInstanceId) return;
        const instance = result.model.elements
          .flatMap((element) => element.instances)
          .find((candidate) => candidate.id === result.createdInstanceId);
        if (!instance) return;
        setEditorInstanceId(instance.id);
        requestAnimationFrame(() => document.getElementById("ship-editor-title")?.focus());
      },
    );
  }

  async function dropShip(definitionId: string, targetElementInstanceId: string) {
    const item = model.catalog.find((candidate) => candidate.id === definitionId);
    if (
      !item?.eligibleTargets.some((target) => target.elementInstanceId === targetElementInstanceId)
    )
      return;
    setSelectedId(item.id);
    setSelectedTarget(targetElementInstanceId);
    const result = await execute(
      { type: "add", definitionId, targetElementInstanceId },
      `${item.name} добавлен в состав.`,
    );
    setDraggedDefinitionId(null);
    if (result) setActiveView("composition");
  }

  async function retrySave() {
    setBusy(true);
    const next = await session.retrySave();
    setState({ kind: "ready", session, model: next });
    setAnnouncement(
      next.summary.persistence === "saved-local"
        ? "Состав сохранён на устройстве."
        : "Повторное сохранение не удалось; изменения остаются в памяти.",
    );
    setBusy(false);
  }

  function followIssue(targetId: string, returnId: string) {
    setIssueReturnId(returnId);
    const target = document.getElementById(targetId);
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }

  function returnToIssue() {
    const source = issueReturnId;
    if (!source) return;
    document.getElementById(source)?.focus();
    setIssueReturnId(null);
  }

  function closeEditor() {
    const origin = contextOrigin;
    setActiveView(origin?.view ?? "composition");
    setAnnouncement("Возврат из редактора корабля.");
    if (location.search)
      void navigate({ pathname: location.pathname, search: "" }, { replace: true });
    if (origin)
      requestAnimationFrame(() =>
        document.getElementById(origin.elementId)?.focus({ preventScroll: true }),
      );
  }

  function openCatalogForElement(element: FleetElementReadModel) {
    const compatibleCategories = new Set(
      model.catalog
        .filter((item) =>
          item.eligibleTargets.some((target) => target.elementInstanceId === element.id),
        )
        .map((item) => item.category),
    );
    const label = element.label.toLocaleLowerCase("ru");
    const matchingCategory = fleetCategories.find(
      (candidate) =>
        compatibleCategories.has(candidate) && label.includes(candidate.toLocaleLowerCase("ru")),
    );
    const nextCategory =
      matchingCategory ?? (compatibleCategories.size === 1 ? [...compatibleCategories][0]! : "all");

    setCatalogTargetId(element.id);
    setSelectedTarget(element.id);
    setCategory(nextCategory);
    setQuery("");
    setCatalogCollapsed(false);
    setActiveView("catalog");
    setAnnouncement(`Открыт каталог подходящих кораблей для ${element.label}.`);
    requestAnimationFrame(() => document.getElementById("catalog-title")?.focus());
  }

  async function changeBattlefleet(battlefleetId: string) {
    if (battlefleetId === model.roster.battlefleetId) return;
    const option = model.roster.battlefleets.find((candidate) => candidate.id === battlefleetId);
    if (!option) return;
    if (
      option.removedShipCount > 0 &&
      !window.confirm(
        `При смене Battlefleet будет удалено несовместимых кораблей: ${option.removedShipCount}. Продолжить?`,
      )
    )
      return;
    const result = await execute(
      { type: "change-battlefleet", battlefleetId },
      `Battlefleet изменён на ${option.label}.`,
    );
    if (!result?.battlefleetChange) return;
    setSelectedId(null);
    setSelectedTarget("");
    setCatalogTargetId(null);
    setEditorInstanceId(null);
    setContextOrigin(null);
    setActiveView("composition");
    setIssueReturnId(null);
    if (location.search)
      void navigate({ pathname: location.pathname, search: "" }, { replace: true });
    const { preservedShipCount, removedShipCount } = result.battlefleetChange;
    setAnnouncement(
      `Battlefleet изменён на ${option.label}. Сохранено кораблей: ${preservedShipCount}. Удалено несовместимых: ${removedShipCount}. Points ${result.model.summary.points}, VPR ${result.model.summary.victoryPoints}.`,
    );
  }

  return (
    <div className="fleet-workspace" data-active-view={resolvedActiveView}>
      <div className="workspace-command-deck">
        <header className="workspace-command-strip" id="workspace-summary" tabIndex={-1}>
          <div className="fleet-workspace__identity">
            <p className="eyebrow">{model.roster.faction}</p>
            <h1>{model.roster.name}</h1>
          </div>
          <dl className="workspace-command-metrics" aria-label="Параметры флота">
            <div>
              <dt>Points</dt>
              <dd>
                {model.summary.points} / {model.summary.pointsLimit}
              </dd>
            </div>
            <div>
              <dt>VPR</dt>
              <dd>{model.summary.victoryPoints}</dd>
            </div>
          </dl>
          <label className="battlefleet-switcher">
            <span>Battlefleet</span>
            <select
              disabled={busy || model.roster.battlefleets.length < 2}
              onChange={(event) => void changeBattlefleet(event.target.value)}
              value={model.roster.battlefleetId}
            >
              {model.roster.battlefleets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.removedShipCount > 0 ? ` · удалит ${option.removedShipCount}` : ""}
                </option>
              ))}
            </select>
          </label>
        </header>

        {model.summary.persistence === "save-error" ? (
          <div className="system-message system-message--error" role="alert">
            <div>
              <strong>Не удалось сохранить на устройстве</strong>
              <p>
                Текущий состав остаётся в памяти. Повторите сохранение или не закрывайте вкладку.
              </p>
            </div>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() => void retrySave()}
              type="button"
            >
              Повторить
            </button>
          </div>
        ) : null}

        {commandError ? (
          <p className="system-message system-message--error" role="alert">
            {commandError}
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>

      <nav
        className="workspace-view-switcher workspace-view-switcher--tablet"
        aria-label="Боковая область билдера"
      >
        {(["catalog", "context"] as const).map((view) => (
          <button
            aria-current={
              (view === "catalog" && resolvedActiveView !== "context") ||
              resolvedActiveView === view
                ? "page"
                : undefined
            }
            key={view}
            onClick={() => {
              if (view === "catalog") setCatalogTargetId(null);
              setActiveView(view);
            }}
            type="button"
          >
            {view === "catalog" ? "Каталог" : "Инспектор"}
          </button>
        ))}
      </nav>

      <nav
        className="workspace-view-switcher workspace-view-switcher--mobile"
        aria-label="Область билдера"
      >
        {(["catalog", "composition", "context"] as const).map((view) => (
          <button
            aria-current={resolvedActiveView === view ? "page" : undefined}
            key={view}
            onClick={() => {
              if (view === "catalog") setCatalogTargetId(null);
              setActiveView(view);
            }}
            type="button"
          >
            {view === "composition" ? "Состав" : view === "catalog" ? "Каталог" : "Корабль"}
          </button>
        ))}
      </nav>

      <div
        className="builder-grid"
        data-catalog-collapsed={catalogCollapsed}
        data-context-collapsed={contextCollapsed}
      >
        <CatalogPane
          category={category}
          collapsed={catalogCollapsed}
          draggedId={draggedDefinitionId}
          faction={model.roster.faction}
          filtered={filtered}
          onCategory={setCategory}
          onDragEnd={() => setDraggedDefinitionId(null)}
          onDragStart={(item, event) => {
            setDraggedDefinitionId(item.id);
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-dwb-ship-id", item.id);
          }}
          onInspect={(item) => openShipProfile(item.name, session.editor(null, item.id))}
          onOpenOrbat={(name, imageUrl) => openShipOrbat(name, imageUrl)}
          onPreview={openPreview}
          onToggle={() => setCatalogCollapsed((current) => !current)}
          query={query}
          selectedId={resolvedSelectedId}
          setQuery={setQuery}
          total={model.catalog.length}
        />

        <CompositionPane
          busy={busy}
          draggedItem={
            model.catalog.find((candidate) => candidate.id === draggedDefinitionId) ?? null
          }
          model={model}
          onFollowIssue={followIssue}
          onDoctrineCommand={(command, message) => void execute(command, message)}
          onDelete={(instanceId, name, elementId) =>
            void execute(
              { type: "delete", instanceId },
              `${name} удалён из состава.`,
              `fleet-element-${safeId(elementId)}`,
            )
          }
          onDuplicate={(instanceId, name) =>
            void execute({ type: "duplicate", instanceId }, `${name}: создана новая копия.`)
          }
          onEdit={(instance) => {
            setContextOrigin({
              view: "composition",
              elementId: `edit-instance-${safeId(instance.id)}`,
            });
            setSelectedId(instance.definitionId);
            setEditorInstanceId(instance.id);
            setActiveView("context");
            requestAnimationFrame(() => document.getElementById("ship-editor-title")?.focus());
          }}
          onInspect={(instance) =>
            openShipProfile(instance.name, session.editor(instance.id, instance.definitionId))
          }
          onOpenOrbat={(name, imageUrl) => openShipOrbat(name, imageUrl)}
          onOpenCatalog={openCatalogForElement}
          onDrop={(definitionId, elementId) => void dropShip(definitionId, elementId)}
          onReturnToIssue={returnToIssue}
          returnTarget={issueReturnId}
          selectedInstanceId={resolvedEditorInstanceId}
        />

        <ContextPane
          busy={busy}
          collapsed={contextCollapsed}
          onAdd={() => void addSelected()}
          onTarget={setSelectedTarget}
          editor={selected ? session.editor(resolvedEditorInstanceId, selected.id) : null}
          onEditorCommand={(command, message) => void execute(command, message)}
          onEditorBack={closeEditor}
          selected={selected}
          selectedTarget={selectedTarget}
          onToggle={() => setContextCollapsed((current) => !current)}
        />
      </div>
      {profilePreview ? (
        <ShipProfileDialog
          faction={model.roster.faction}
          imageSearchHref={shipImageSearchUrl(profilePreview.name)}
          model={profilePreview.model}
          name={profilePreview.name}
          onClose={() => setProfilePreview(null)}
        />
      ) : null}
      {orbatPreview ? (
        <ShipOrbatPageDialog
          imageUrl={orbatPreview.imageUrl}
          name={orbatPreview.name}
          onClose={() => setOrbatPreview(null)}
        />
      ) : null}
    </div>
  );
}

function CatalogPane({
  category,
  collapsed,
  draggedId,
  faction,
  filtered,
  onCategory,
  onDragEnd,
  onDragStart,
  onInspect,
  onOpenOrbat,
  onPreview,
  onToggle,
  query,
  selectedId,
  setQuery,
  total,
}: {
  readonly category: FleetCategory | "all";
  readonly collapsed: boolean;
  readonly draggedId: string | null;
  readonly faction: string;
  readonly filtered: readonly CatalogItemReadModel[];
  readonly onCategory: (value: FleetCategory | "all") => void;
  readonly onDragEnd: () => void;
  readonly onDragStart: (item: CatalogItemReadModel, event: DragEvent<HTMLElement>) => void;
  readonly onInspect: (item: CatalogItemReadModel) => void;
  readonly onOpenOrbat: (name: string, imageUrl: string) => void;
  readonly onPreview: (item: CatalogItemReadModel) => void;
  readonly onToggle: () => void;
  readonly query: string;
  readonly selectedId: string | null;
  readonly setQuery: (value: string) => void;
  readonly total: number;
}) {
  return (
    <section
      className="builder-pane catalog-pane"
      aria-labelledby="catalog-title"
      data-collapsed={collapsed}
    >
      <div className="builder-pane__header">
        <div className="builder-pane__title">
          <p className="eyebrow">{total} кораблей</p>
          <h2 id="catalog-title" tabIndex={-1}>
            Каталог
          </h2>
        </div>
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Развернуть каталог" : "Свернуть каталог"}
          className="pane-toggle"
          onClick={onToggle}
          type="button"
        >
          <span aria-hidden="true">{collapsed ? "→" : "←"}</span>
        </button>
      </div>
      <div className="catalog-toolbar">
        <label>
          <span>Поиск</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название, роль, платформа"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span>Категория</span>
          <select
            onChange={(event) => onCategory(event.target.value as FleetCategory | "all")}
            value={category}
          >
            <option value="all">Все категории</option>
            {fleetCategories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="catalog-result-count" role="status">
        Найдено: {filtered.length}
      </p>
      <div className="catalog-list" aria-label="Результаты каталога">
        {filtered.length ? (
          filtered.map((item) => {
            const orbatPageUrl = orbatCardFor(faction, item.name);
            return (
              <div
                className="catalog-row"
                data-availability={item.availability.state}
                data-dragging={draggedId === item.id ? "true" : undefined}
                draggable={item.availability.state === "available"}
                key={item.id}
                onDragEnd={onDragEnd}
                onDragStart={(event) => onDragStart(item, event)}
              >
                <button
                  aria-pressed={selectedId === item.id}
                  className="catalog-row__select"
                  id={`catalog-item-${safeId(item.id)}`}
                  onClick={() => onPreview(item)}
                  type="button"
                >
                  <span className="catalog-row__name">
                    <strong>{item.name}</strong>
                    <small>
                      {item.category} · {item.platform}
                    </small>
                  </span>
                  <span className="catalog-row__cost">
                    <b>{item.points} P</b>
                    <small>{item.victoryPoints} VPR</small>
                  </span>
                  <span className="catalog-row__state">
                    <span aria-hidden="true">
                      {item.availability.state === "available" ? "○" : "!"}
                    </span>
                    {item.availability.state === "available"
                      ? "Доступен"
                      : item.availability.state === "unavailable"
                        ? "Недоступен"
                        : "Нужно проверить"}
                  </span>
                </button>
                <div className="catalog-row__actions">
                  <button
                    aria-label={`Показать профиль ${item.name}`}
                    className="catalog-row__inspect"
                    onClick={() => onInspect(item)}
                    type="button"
                  >
                    <EyeIcon />
                  </button>
                  {orbatPageUrl ? (
                    <button
                      aria-label={`Показать страницу ORBAT ${item.name}`}
                      className="catalog-row__orbat"
                      onClick={() => onOpenOrbat(item.name, orbatPageUrl)}
                      type="button"
                    >
                      <OrbatPageIcon />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <div className="no-results" data-state="no-results">
            <strong>Ничего не найдено</strong>
            <p>Измените запрос или сбросьте категорию.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function CompositionPane({
  busy,
  draggedItem,
  model,
  onDelete,
  onDoctrineCommand,
  onDuplicate,
  onEdit,
  onFollowIssue,
  onInspect,
  onOpenOrbat,
  onOpenCatalog,
  onDrop,
  onReturnToIssue,
  returnTarget,
  selectedInstanceId,
}: {
  readonly busy: boolean;
  readonly draggedItem: CatalogItemReadModel | null;
  readonly model: RosterWorkspaceReadModel;
  readonly onDelete: (instanceId: string, name: string, elementId: string) => void;
  readonly onDoctrineCommand: (command: FleetDoctrineCommand, message: string) => void;
  readonly onDuplicate: (instanceId: string, name: string) => void;
  readonly onEdit: (instance: RosterInstanceReadModel) => void;
  readonly onFollowIssue: (targetId: string, returnId: string) => void;
  readonly onInspect: (instance: RosterInstanceReadModel) => void;
  readonly onOpenOrbat: (name: string, imageUrl: string) => void;
  readonly onOpenCatalog: (element: FleetElementReadModel) => void;
  readonly onDrop: (definitionId: string, elementId: string) => void;
  readonly onReturnToIssue: () => void;
  readonly returnTarget: string | null;
  readonly selectedInstanceId: string | null;
}) {
  const [openIssueElementId, setOpenIssueElementId] = useState<string | null>(null);
  const sectionTargets = new Set(
    model.elements.flatMap((element) => [
      `fleet-element-${safeId(element.id)}`,
      ...element.instances.map((instance) => `roster-instance-${safeId(instance.id)}`),
    ]),
  );
  const compositionProblems = model.problems.filter(
    (problem) => !sectionTargets.has(problem.targetId),
  );
  const firstCompositionProblem = compositionProblems[0] ?? null;
  const compositionIssueId = "composition-issue";

  return (
    <section className="builder-pane composition-pane" aria-labelledby="composition-title">
      <div className="builder-pane__header">
        <p className="eyebrow">Главная область</p>
        <div className="fleet-element__heading-row">
          <h2 id="composition-title">Состав</h2>
          {firstCompositionProblem ? (
            <button
              aria-label={`Открыть общие ошибки состава: ${firstCompositionProblem.reason}`}
              aria-controls={`${compositionIssueId}-details`}
              aria-expanded={openIssueElementId === compositionIssueId}
              className="element-issue"
              data-error-count={compositionProblems.length}
              id={compositionIssueId}
              onClick={() => {
                setOpenIssueElementId((current) =>
                  current === compositionIssueId ? null : compositionIssueId,
                );
                if (firstCompositionProblem.targetId !== "workspace-summary")
                  onFollowIssue(firstCompositionProblem.targetId, compositionIssueId);
              }}
              title={firstCompositionProblem.reason}
              type="button"
            >
              <span aria-hidden="true">!</span>
              <span className="sr-only">{`Ошибок: ${compositionProblems.length}`}</span>
            </button>
          ) : null}
        </div>
      </div>
      {compositionProblems.length && openIssueElementId === compositionIssueId ? (
        <div
          className="element-issue-details composition-issue-details"
          id={`${compositionIssueId}-details`}
          role="status"
        >
          <ul>
            {compositionProblems.map((problem) => (
              <li key={problem.id}>
                <strong>{problem.title}</strong>
                <span>{problem.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="element-list">
        {model.doctrine ? (
          <FleetDoctrinePanel busy={busy} doctrine={model.doctrine} onCommand={onDoctrineCommand} />
        ) : null}
        {model.elements.map((element) => {
          const isDropTarget = Boolean(
            draggedItem?.eligibleTargets.some((target) => target.elementInstanceId === element.id),
          );
          const isOverLimit =
            element.maximum !== null && element.instances.length > element.maximum;
          const elementTargetId = `fleet-element-${safeId(element.id)}`;
          const instanceTargetIds = new Set(
            element.instances.map((instance) => `roster-instance-${safeId(instance.id)}`),
          );
          const elementProblems: readonly {
            readonly id: string;
            readonly title: string;
            readonly reason: string;
            readonly targetId: string;
          }[] = model.problems.filter(
            (problem) =>
              problem.targetId === elementTargetId || instanceTargetIds.has(problem.targetId),
          );
          const structuralProblems =
            isOverLimit && !elementProblems.some((problem) => problem.targetId === elementTargetId)
              ? [
                  {
                    id: `maximum:${element.id}`,
                    title: "Превышен лимит раздела",
                    reason: `Добавлено ${element.instances.length}, максимум ${element.maximum}.`,
                    targetId: elementTargetId,
                  },
                ]
              : [];
          const visibleElementProblems = [...elementProblems, ...structuralProblems];
          const firstProblem = visibleElementProblems[0] ?? null;
          const issueButtonId = `fleet-element-issue-${safeId(element.id)}`;
          return (
            <section
              className="fleet-element"
              data-drop-target={isDropTarget ? "eligible" : undefined}
              id={elementTargetId}
              key={element.id}
              onDragOver={(event) => {
                if (isDropTarget) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!isDropTarget || !draggedItem) return;
                event.preventDefault();
                onDrop(draggedItem.id, element.id);
              }}
              tabIndex={-1}
              aria-labelledby={`fleet-element-title-${safeId(element.id)}`}
            >
              <header>
                <div>
                  <div className="fleet-element__heading-row">
                    <h3 id={`fleet-element-title-${safeId(element.id)}`}>{element.label}</h3>
                    {firstProblem ? (
                      <button
                        aria-label={`Открыть ошибки раздела ${element.label}: ${firstProblem.reason}`}
                        aria-controls={`${issueButtonId}-details`}
                        aria-expanded={openIssueElementId === element.id}
                        className="element-issue"
                        data-error-count={visibleElementProblems.length}
                        id={issueButtonId}
                        onClick={() => {
                          setOpenIssueElementId((current) =>
                            current === element.id ? null : element.id,
                          );
                          if (firstProblem.targetId !== elementTargetId)
                            onFollowIssue(firstProblem.targetId, issueButtonId);
                        }}
                        title={firstProblem.reason}
                        type="button"
                      >
                        <span aria-hidden="true">!</span>
                        <span className="sr-only">
                          {visibleElementProblems.length === 1
                            ? "Одна ошибка"
                            : `Ошибок: ${visibleElementProblems.length}`}
                        </span>
                      </button>
                    ) : null}
                  </div>
                  <p
                    aria-label={`${isOverLimit ? "Лимит превышен. " : ""}Выбрано ${element.instances.length}, минимум ${element.minimum}, максимум ${element.maximum ?? "не ограничен"}`}
                    className="fleet-element__limit"
                    data-state={isOverLimit ? "exceeded" : "within"}
                  >
                    {isOverLimit ? <span aria-hidden="true">! </span> : null}
                    {element.instances.length} выбрано · {element.minimum} мин. ·{" "}
                    {element.maximum ?? "—"} макс.
                  </p>
                </div>
              </header>
              {visibleElementProblems.length && openIssueElementId === element.id ? (
                <div
                  className="element-issue-details"
                  id={`${issueButtonId}-details`}
                  role="status"
                >
                  <ul>
                    {visibleElementProblems.map((problem) => (
                      <li key={problem.id}>
                        <strong>{problem.title}</strong>
                        <span>{problem.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {returnTarget ? (
                <button className="issue-return" onClick={onReturnToIssue} type="button">
                  ← Вернуться к проблеме
                </button>
              ) : null}
              {element.instances.length ? (
                <ul className="roster-instance-list">
                  {element.instances.map((instance) => {
                    const loadout = instance.loadout;
                    const orbatPageUrl = orbatCardFor(model.roster.faction, instance.name);
                    return (
                      <li
                        aria-current={selectedInstanceId === instance.id ? "true" : undefined}
                        id={`roster-instance-${safeId(instance.id)}`}
                        key={instance.id}
                        tabIndex={-1}
                      >
                        <span className="instance-copy">
                          <span className="instance-title">
                            <strong>{instance.name}</strong>
                            <button
                              aria-label={`Показать профиль ${instance.name}`}
                              className="instance-inspect"
                              onClick={() => onInspect(instance)}
                              type="button"
                            >
                              <EyeIcon />
                            </button>
                            {orbatPageUrl ? (
                              <button
                                aria-label={`Показать страницу ORBAT ${instance.name}`}
                                className="instance-orbat"
                                onClick={() => onOpenOrbat(instance.name, orbatPageUrl)}
                                type="button"
                              >
                                <OrbatPageIcon />
                              </button>
                            ) : null}
                          </span>
                          <small>
                            {instance.points} Points · {instance.victoryPoints} VPR
                          </small>
                          <small className="instance-loadout">
                            {loadout.length ? loadout.join(" · ") : "Оружие не указано"}
                          </small>
                        </span>
                        <span className="instance-actions">
                          <button
                            aria-label={`Настроить ${instance.name}`}
                            className="instance-action"
                            disabled={busy}
                            id={`edit-instance-${safeId(instance.id)}`}
                            onClick={() => onEdit(instance)}
                            title="Настроить"
                            type="button"
                          >
                            <InstanceActionIcon kind="configure" />
                          </button>
                          <button
                            aria-label={`Копировать ${instance.name}`}
                            className="instance-action"
                            disabled={busy}
                            onClick={() => onDuplicate(instance.id, instance.name)}
                            title="Копировать"
                            type="button"
                          >
                            <InstanceActionIcon kind="duplicate" />
                          </button>
                          <button
                            aria-label={`Удалить ${instance.name}`}
                            className="instance-action instance-action--delete"
                            disabled={busy}
                            onClick={() => onDelete(instance.id, instance.name, element.id)}
                            title="Удалить"
                            type="button"
                          >
                            <InstanceActionIcon kind="delete" />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <button
                  aria-label={`Добавить подходящий корабль в ${element.label}`}
                  className="element-empty"
                  onClick={() => onOpenCatalog(element)}
                  type="button"
                >
                  <span aria-hidden="true">＋</span>
                  <p>Добавьте подходящий корабль из каталога.</p>
                </button>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ContextPane({
  busy,
  collapsed,
  onAdd,
  onTarget,
  editor,
  onEditorBack,
  onEditorCommand,
  selected,
  selectedTarget,
  onToggle,
}: {
  readonly busy: boolean;
  readonly collapsed: boolean;
  readonly onAdd: () => void;
  readonly onTarget: (value: string) => void;
  readonly editor: ShipEditorReadModel | null;
  readonly onEditorBack: () => void;
  readonly onEditorCommand: (command: ShipEditorCommand, message: string) => void;
  readonly selected: CatalogItemReadModel | null;
  readonly selectedTarget: string;
  readonly onToggle: () => void;
}) {
  return (
    <aside
      aria-label={editor ? "Инспектор корабля" : undefined}
      aria-labelledby={editor ? undefined : "context-title"}
      className="builder-pane context-pane"
      data-collapsed={collapsed}
    >
      {editor ? null : (
        <div className="builder-pane__header">
          <div className="builder-pane__title">
            <p className="eyebrow">Корабль и проблемы</p>
            <h2 id="context-title">Инспектор</h2>
          </div>
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Развернуть инспектор" : "Свернуть инспектор"}
            className="pane-toggle"
            onClick={onToggle}
            type="button"
          >
            <span aria-hidden="true">{collapsed ? "←" : "→"}</span>
          </button>
        </div>
      )}
      {editor ? (
        <ShipEditorShell
          busy={busy}
          model={editor}
          onAdd={onAdd}
          onBack={onEditorBack}
          onCommand={onEditorCommand}
        />
      ) : selected ? (
        <article className="catalog-preview">
          <p className="preview-category">
            {selected.category} · {selected.role}
          </p>
          <h3>{selected.name}</h3>
          <dl>
            <div>
              <dt>Points</dt>
              <dd>{selected.points}</dd>
            </div>
            <div>
              <dt>VPR</dt>
              <dd>{selected.victoryPoints}</dd>
            </div>
            <div>
              <dt>Платформа</dt>
              <dd>{selected.platform}</dd>
            </div>
            <div>
              <dt>Флот</dt>
              <dd>{selected.nation}</dd>
            </div>
          </dl>
          <p>{selected.preview}</p>
          {selected.availability.reason ? (
            <p className="availability-reason" role="note">
              <strong>
                {selected.availability.state === "unavailable" ? "Недоступен" : "Нужно проверить"}.
              </strong>{" "}
              {selected.availability.reason}
            </p>
          ) : null}
          {selected.eligibleTargets.length > 1 ? (
            <fieldset className="target-chooser">
              <legend>Добавить в Battlefleet Element</legend>
              {selected.eligibleTargets.map((target) => (
                <label key={target.elementInstanceId}>
                  <input
                    checked={selectedTarget === target.elementInstanceId}
                    name="target-element"
                    onChange={() => onTarget(target.elementInstanceId)}
                    type="radio"
                  />
                  {target.elementLabel}
                </label>
              ))}
            </fieldset>
          ) : selected.eligibleTargets.length === 1 ? (
            <p className="one-click-target">
              Будет добавлен в {selected.eligibleTargets[0]!.elementLabel}.
            </p>
          ) : null}
          <button
            className="button preview-add"
            disabled={
              busy ||
              selected.availability.state !== "available" ||
              (selected.eligibleTargets.length > 1 && !selectedTarget)
            }
            onClick={onAdd}
            type="button"
          >
            {selected.availability.state === "available"
              ? "Добавить в состав"
              : "Добавление недоступно"}
          </button>
        </article>
      ) : (
        <div className="context-empty">
          <span aria-hidden="true">↗</span>
          <h3>Выберите корабль</h3>
          <p>Просмотр не меняет состав, очки или сохранённую копию.</p>
        </div>
      )}
    </aside>
  );
}

function LoadingWorkspace() {
  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Локальный состав</p>
        <h1>Открываем флот</h1>
        <p className="page-lead" role="status">
          Читаем состав и безопасный каталог…
        </p>
      </div>
    </div>
  );
}

function UnavailableWorkspace() {
  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Системная доступность</p>
        <h1>Каталог недоступен</h1>
        <p className="page-lead" role="alert">
          Локальный состав не изменён. Обновите страницу, чтобы повторить загрузку.
        </p>
      </div>
      <Link className="button" to="/">
        К библиотеке
      </Link>
    </div>
  );
}

function InvalidRoster() {
  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Некорректная ссылка</p>
        <h1>Флот не найден</h1>
        <p className="page-lead">В локальном хранилище нет подходящего флота.</p>
      </div>
      <Link className="button" to="/">
        К библиотеке
      </Link>
    </div>
  );
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

function InstanceActionIcon({ kind }: { readonly kind: "configure" | "duplicate" | "delete" }) {
  return (
    <svg
      aria-hidden="true"
      className="instance-action__icon"
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
    >
      {kind === "configure" ? (
        <>
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
          <circle cx="14" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </>
      ) : kind === "duplicate" ? (
        <>
          <rect height="12" rx="1.5" width="12" x="8" y="8" />
          <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
        </>
      ) : (
        <>
          <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
        </>
      )}
    </svg>
  );
}

function directEditorLink(search: string): {
  readonly shipId: string;
  readonly mode: "preview" | "instance";
  readonly ruleId: string | null;
} | null {
  const params = new URLSearchParams(search);
  const shipId = params.get("ship");
  const mode = params.get("shipMode");
  const ruleId = params.get("rule");
  if (!stableToken(shipId) || (mode !== "preview" && mode !== "instance")) return null;
  return { shipId, mode, ruleId: stableToken(ruleId) ? ruleId : null };
}

function stableToken(value: string | null): value is string {
  return Boolean(
    value &&
    value.length <= 240 &&
    !/^(?:https?|javascript|data|vbscript|mailto):|^\/\//iu.test(value),
  );
}
