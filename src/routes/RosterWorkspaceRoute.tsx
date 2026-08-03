import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import {
  filterCatalogItems,
  fleetCategories,
  openRosterWorkspace,
  WorkspaceCommandError,
  type CatalogItemReadModel,
  type FleetCategory,
  type RosterWorkspaceDependencies,
  type RosterWorkspaceExecution,
  type RosterInstanceReadModel,
  type RosterWorkspaceReadModel,
  type RosterWorkspaceSession,
} from "../application/rosters/workspace";
import {
  ShipEditorCommandError,
  type ShipEditorCommand,
  type ShipEditorReadModel,
} from "../application/rosters/ship-editor";
import { useDocumentTitle } from "../app/useDocumentTitle";
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
  const [editorInstanceId, setEditorInstanceId] = useState<string | null>(null);
  const [contextOrigin, setContextOrigin] = useState<ContextOrigin | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("composition");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const [issueReturnId, setIssueReturnId] = useState<string | null>(null);
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
    if (!directFocusKey) {
      handledDirectFocusKey.current = null;
      return;
    }
    if (state.kind !== "ready") return;
    if (directRuleId) {
      handledDirectFocusKey.current = directFocusKey;
      return;
    }
    if (handledDirectFocusKey.current === directFocusKey) return;
    handledDirectFocusKey.current = directFocusKey;
    const frame = requestAnimationFrame(() => {
      document.getElementById("ship-editor-title")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [directFocusKey, directRuleId, state.kind]);

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
  const filtered = filterCatalogItems(model.catalog, query, category);
  const selected = model.catalog.find((item) => item.id === resolvedSelectedId) ?? null;

  async function execute(
    command: Parameters<RosterWorkspaceSession["execute"]>[0],
    success: string,
    focusId?: string,
  ): Promise<RosterWorkspaceExecution | null> {
    setBusy(true);
    setCommandError(null);
    try {
      const result = await session.executeDetailed(command);
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
      setBusy(false);
    }
  }

  function openPreview(item: CatalogItemReadModel) {
    setContextOrigin({ view: "catalog", elementId: `catalog-item-${safeId(item.id)}` });
    setSelectedId(item.id);
    setSelectedTarget(
      item.eligibleTargets.length === 1 ? item.eligibleTargets[0]!.elementInstanceId : "",
    );
    setCommandError(null);
    setEditorInstanceId(null);
    setActiveView("context");
    if (session.editor(null, item.id))
      requestAnimationFrame(() => document.getElementById("ship-editor-title")?.focus());
  }

  async function addSelected() {
    if (!selected) return;
    const result = await execute(
      {
        type: "add",
        definitionId: selected.id,
        ...(selectedTarget ? { targetElementInstanceId: selectedTarget } : {}),
      },
      `${selected.name} добавлен в состав.`,
    );
    if (result?.createdInstanceId && session.editor(result.createdInstanceId, selected.id)) {
      const instance = result.model.elements
        .flatMap((element) => element.instances)
        .find((candidate) => candidate.id === result.createdInstanceId);
      if (instance) {
        setEditorInstanceId(instance.id);
        requestAnimationFrame(() => document.getElementById("ship-editor-title")?.focus());
      }
    }
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

  function followIssue(problemId: string, targetId: string) {
    const problemIndex = model.problems.findIndex((problem) => problem.id === problemId);
    setIssueReturnId(problemIndex >= 0 ? `workspace-issue-${problemIndex}` : null);
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

  return (
    <div className="fleet-workspace" data-active-view={resolvedActiveView}>
      <header className="fleet-workspace__heading">
        <div>
          <p className="eyebrow">
            {model.roster.faction} · {model.roster.battlefleet}
          </p>
          <h1>{model.roster.name}</h1>
        </div>
        <Link className="button button--secondary" to="/rosters/new">
          Новый флот
        </Link>
      </header>

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
            onClick={() => setActiveView(view)}
            type="button"
          >
            {view === "catalog" ? "Каталог" : "Контекст"}
          </button>
        ))}
      </nav>

      <nav
        className="workspace-view-switcher workspace-view-switcher--mobile"
        aria-label="Область билдера"
      >
        {(["composition", "catalog", "context"] as const).map((view) => (
          <button
            aria-current={resolvedActiveView === view ? "page" : undefined}
            key={view}
            onClick={() => setActiveView(view)}
            type="button"
          >
            {view === "composition" ? "Состав" : view === "catalog" ? "Каталог" : "Контекст"}
          </button>
        ))}
      </nav>

      <WorkspaceSummary busy={busy} model={model} />

      {model.summary.persistence === "save-error" ? (
        <div className="system-message system-message--error" role="alert">
          <div>
            <strong>Не удалось сохранить на устройстве</strong>
            <p>Текущий состав остаётся в памяти. Повторите сохранение или не закрывайте вкладку.</p>
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

      <div className="builder-grid">
        <CatalogPane
          category={category}
          filtered={filtered}
          onCategory={setCategory}
          onPreview={openPreview}
          query={query}
          selectedId={resolvedSelectedId}
          setQuery={setQuery}
          total={model.catalog.length}
        />

        <CompositionPane
          busy={busy}
          model={model}
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
          onReturnToIssue={returnToIssue}
          returnTarget={issueReturnId}
        />

        <ContextPane
          busy={busy}
          model={model}
          onAdd={() => void addSelected()}
          onFollowIssue={followIssue}
          onTarget={setSelectedTarget}
          editor={selected ? session.editor(resolvedEditorInstanceId, selected.id) : null}
          onEditorCommand={(command, message) => void execute(command, message)}
          onEditorBack={closeEditor}
          onOpenRule={(ruleId) => {
            if (!selected) return;
            const search = new URLSearchParams(location.search);
            search.set("ship", resolvedEditorInstanceId ?? selected.id);
            search.set("shipMode", resolvedEditorInstanceId ? "instance" : "preview");
            search.set("rule", ruleId);
            void navigate({ pathname: location.pathname, search: `?${search.toString()}` });
          }}
          onRuleBack={() => {
            const search = new URLSearchParams(location.search);
            search.delete("rule");
            void navigate(
              { pathname: location.pathname, search: search.size ? `?${search.toString()}` : "" },
              { replace: true },
            );
          }}
          ruleId={direct?.ruleId ?? null}
          selected={selected}
          selectedTarget={selectedTarget}
        />
      </div>
    </div>
  );
}

function WorkspaceSummary({
  busy,
  model,
}: {
  readonly busy: boolean;
  readonly model: RosterWorkspaceReadModel;
}) {
  const persistenceState = busy ? "saving" : model.summary.persistence;
  const persistenceLabel = busy ? "Сохранение…" : model.summary.persistenceLabel;
  return (
    <dl
      className="workspace-summary workspace-summary--sticky"
      id="workspace-summary"
      aria-label="Сводка флота"
    >
      <div className="summary-item">
        <dt>Points</dt>
        <dd>
          {model.summary.points} / {model.summary.pointsLimit}
        </dd>
      </div>
      <div className="summary-item">
        <dt>VP</dt>
        <dd>
          {model.summary.victoryPoints} / {model.summary.victoryPointsLimit}
        </dd>
      </div>
      <div className="summary-item" data-axis="validity" data-state={model.summary.validity}>
        <dt>Состав</dt>
        <dd>
          <span aria-hidden="true">{model.summary.validity === "valid" ? "✓" : "!"}</span>{" "}
          {model.summary.validityLabel}
        </dd>
      </div>
      <div className="summary-item" data-axis="persistence" data-state={persistenceState}>
        <dt>Сохранение</dt>
        <dd>
          <span aria-hidden="true">{persistenceState === "saved-local" ? "✓" : "↻"}</span>{" "}
          {persistenceLabel}
        </dd>
      </div>
      <div
        className="summary-item"
        data-axis="availability"
        data-state={model.summary.availability}
      >
        <dt>Система</dt>
        <dd>
          <span aria-hidden="true">●</span> {model.summary.availabilityLabel}
        </dd>
      </div>
    </dl>
  );
}

function CatalogPane({
  category,
  filtered,
  onCategory,
  onPreview,
  query,
  selectedId,
  setQuery,
  total,
}: {
  readonly category: FleetCategory | "all";
  readonly filtered: readonly CatalogItemReadModel[];
  readonly onCategory: (value: FleetCategory | "all") => void;
  readonly onPreview: (item: CatalogItemReadModel) => void;
  readonly query: string;
  readonly selectedId: string | null;
  readonly setQuery: (value: string) => void;
  readonly total: number;
}) {
  return (
    <section className="builder-pane catalog-pane" aria-labelledby="catalog-title">
      <div className="builder-pane__header">
        <p className="eyebrow">{total} учебных записей</p>
        <h2 id="catalog-title">Каталог</h2>
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
          filtered.map((item) => (
            <button
              aria-pressed={selectedId === item.id}
              className="catalog-row"
              data-availability={item.availability.state}
              id={`catalog-item-${safeId(item.id)}`}
              key={item.id}
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
                <small>{item.victoryPoints} VP</small>
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
          ))
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
  model,
  onDelete,
  onDuplicate,
  onEdit,
  onReturnToIssue,
  returnTarget,
}: {
  readonly busy: boolean;
  readonly model: RosterWorkspaceReadModel;
  readonly onDelete: (instanceId: string, name: string, elementId: string) => void;
  readonly onDuplicate: (instanceId: string, name: string) => void;
  readonly onEdit: (instance: RosterInstanceReadModel) => void;
  readonly onReturnToIssue: () => void;
  readonly returnTarget: string | null;
}) {
  return (
    <section className="builder-pane composition-pane" aria-labelledby="composition-title">
      <div className="builder-pane__header">
        <p className="eyebrow">Главная область</p>
        <h2 id="composition-title">Состав</h2>
      </div>
      <div className="element-list">
        {model.elements.map((element) => (
          <section
            className="fleet-element"
            id={`fleet-element-${safeId(element.id)}`}
            key={element.id}
            tabIndex={-1}
            aria-labelledby={`fleet-element-title-${safeId(element.id)}`}
          >
            <header>
              <div>
                <h3 id={`fleet-element-title-${safeId(element.id)}`}>{element.label}</h3>
                <p>
                  {element.instances.length} / {element.minimum} обязательно
                </p>
              </div>
              <span
                className={
                  element.instances.length >= element.minimum
                    ? "element-state element-state--ready"
                    : "element-state element-state--error"
                }
              >
                <span aria-hidden="true">
                  {element.instances.length >= element.minimum ? "✓" : "!"}
                </span>
                {element.instances.length >= element.minimum ? "Заполнен" : "Нужен корабль"}
              </span>
            </header>
            {returnTarget ? (
              <button className="issue-return" onClick={onReturnToIssue} type="button">
                ← Вернуться к проблеме
              </button>
            ) : null}
            {element.instances.length ? (
              <ul className="roster-instance-list">
                {element.instances.map((instance) => (
                  <li id={`roster-instance-${safeId(instance.id)}`} key={instance.id} tabIndex={-1}>
                    <span>
                      <strong>{instance.name}</strong>
                      <small>
                        {instance.points} Points · {instance.victoryPoints} VP
                      </small>
                    </span>
                    <span className="instance-actions">
                      <button
                        disabled={busy}
                        id={`edit-instance-${safeId(instance.id)}`}
                        onClick={() => onEdit(instance)}
                        type="button"
                      >
                        Настроить
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onDuplicate(instance.id, instance.name)}
                        type="button"
                      >
                        Копировать
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onDelete(instance.id, instance.name, element.id)}
                        type="button"
                      >
                        Удалить
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="element-empty">
                <span aria-hidden="true">＋</span>
                <p>Добавьте подходящий корабль из каталога.</p>
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function ContextPane({
  busy,
  model,
  onAdd,
  onFollowIssue,
  onTarget,
  editor,
  onEditorBack,
  onEditorCommand,
  onOpenRule,
  onRuleBack,
  ruleId,
  selected,
  selectedTarget,
}: {
  readonly busy: boolean;
  readonly model: RosterWorkspaceReadModel;
  readonly onAdd: () => void;
  readonly onFollowIssue: (problemId: string, targetId: string) => void;
  readonly onTarget: (value: string) => void;
  readonly editor: ShipEditorReadModel | null;
  readonly onEditorBack: () => void;
  readonly onEditorCommand: (command: ShipEditorCommand, message: string) => void;
  readonly onOpenRule: (ruleId: string) => void;
  readonly onRuleBack: () => void;
  readonly ruleId: string | null;
  readonly selected: CatalogItemReadModel | null;
  readonly selectedTarget: string;
}) {
  return (
    <aside className="builder-pane context-pane" aria-labelledby="context-title">
      <div className="builder-pane__header">
        <p className="eyebrow">Preview и проблемы</p>
        <h2 id="context-title">Контекст</h2>
      </div>
      {editor ? (
        <ShipEditorShell
          busy={busy}
          model={editor}
          onAdd={onAdd}
          onBack={onEditorBack}
          onCommand={onEditorCommand}
          onOpenRule={onOpenRule}
          onRuleBack={onRuleBack}
          ruleId={ruleId}
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
              <dt>VP</dt>
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
          <p>Preview не меняет состав, totals или сохранённую копию.</p>
        </div>
      )}

      <section className="problem-center" aria-labelledby="problem-center-title">
        <header>
          <h3 id="problem-center-title">Проблемы состава</h3>
          <span>
            {model.summary.errorCount} ошибок · {model.summary.warningCount} предупреждений
          </span>
        </header>
        {model.problems.length ? (
          <ul>
            {model.problems.map((problem, problemIndex) => (
              <li key={problem.id}>
                <button
                  id={`workspace-issue-${problemIndex}`}
                  onClick={() => onFollowIssue(problem.id, problem.targetId)}
                  type="button"
                >
                  <span className="problem-severity" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <strong>{problem.title}</strong>
                    <small>
                      {problem.locationLabel} · {problem.reason}
                    </small>
                    <em>{problem.guidance}</em>
                  </span>
                  <b aria-hidden="true">→</b>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="problem-empty">
            <span aria-hidden="true">✓</span>
            <p>Проверяемых проблем нет.</p>
          </div>
        )}
      </section>
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
