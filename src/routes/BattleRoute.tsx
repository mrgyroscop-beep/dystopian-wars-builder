import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useDocumentTitle } from "../app/useDocumentTitle";
import type { AuthGateway, AuthUser } from "../application/auth/auth-contract";
import {
  criticalEffectIds,
  type BattleGateway,
  type BattlePlayer,
  type BattleRoom,
  type BattleSide,
  type CriticalEffectId,
  type RoomKey,
  type ShipBattleState,
} from "../application/battle/battle-contract";
import type { RosterLibraryRepository } from "../application/rosters/roster-library";
import {
  isShipEditorDefinition,
  projectShipEditor,
  type ShipEditorReadyReadModel,
} from "../application/rosters/ship-editor";
import type { RosterCatalogGateway } from "../application/rosters/workspace";
import type { StoredRoster } from "../application/rosters/create-roster";
import type { DomainCatalog } from "../domain/catalog";
import { ShipProfileDialog } from "../ui/ProfileDialog";

const activeBattleKey = "dwb.battle.active.v1";
const emptyShipState: ShipBattleState = {
  damage: 0,
  disorder: 0,
  criticals: {},
  crippled: false,
  destroyed: false,
  withdrawn: false,
  activated: false,
};

const criticals: Record<
  CriticalEffectId,
  {
    readonly image: string;
    readonly label: string;
    readonly short: string;
    readonly mark: string;
  }
> = {
  breach: {
    image: "/battle/critical-dice/breach.webp",
    label: "Пробоина",
    short: "Breach",
    mark: "BR",
  },
  "structural-failure": {
    image: "/battle/critical-dice/structural-failure.webp",
    label: "Разрушение конструкции",
    short: "Structural Failure",
    mark: "SF",
  },
  hazard: {
    image: "/battle/critical-dice/hazard.webp",
    label: "Авария",
    short: "Hazard",
    mark: "HZ",
  },
  "shredded-defences": {
    image: "/battle/critical-dice/shredded-defences.webp",
    label: "Разрушенная защита",
    short: "Shredded Defences",
    mark: "SD",
  },
  "navigation-lock": {
    image: "/battle/critical-dice/navigation-lock.webp",
    label: "Блокировка навигации",
    short: "Navigation Lock",
    mark: "NL",
  },
  "system-failure": {
    image: "/battle/critical-dice/system-failure.webp",
    label: "Отказ систем",
    short: "System Failure",
    mark: "SY",
  },
};

export interface BattleRouteDependencies {
  readonly authGateway: AuthGateway;
  readonly battleGateway: BattleGateway;
  readonly catalogGateway: RosterCatalogGateway;
  readonly rosterRepository: RosterLibraryRepository;
}

type InitialState =
  | { readonly kind: "loading" }
  | { readonly kind: "signed-out" }
  | { readonly kind: "lobby"; readonly user: AuthUser; readonly rosters: readonly StoredRoster[] }
  | {
      readonly kind: "room";
      readonly user: AuthUser;
      readonly rosters: readonly StoredRoster[];
      readonly room: BattleRoom;
    }
  | { readonly kind: "error"; readonly message: string };

export function BattleRoute({
  authGateway,
  battleGateway,
  catalogGateway,
  rosterRepository,
}: BattleRouteDependencies) {
  useDocumentTitle("Баталия");
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<InitialState>({ kind: "loading" });
  const [selectedRosterId, setSelectedRosterId] = useState("");
  const [joinKey, setJoinKey] = useState<CriticalEffectId[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const user = await authGateway.session();
      if (!user) return setState({ kind: "signed-out" });
      const rosters = await rosterRepository.list();
      setSelectedRosterId((current) => current || rosters[0]?.id || "");
      const encoded = searchParams.get("key") ?? localStorage.getItem(activeBattleKey);
      if (encoded) {
        const parsed = parseKey(encoded);
        if (parsed) {
          try {
            const room = await battleGateway.read(parsed);
            setState({ kind: "room", user, rosters, room });
            localStorage.setItem(activeBattleKey, room.key.join("."));
            return;
          } catch {
            localStorage.removeItem(activeBattleKey);
          }
        }
      }
      setState({ kind: "lobby", user, rosters });
    } catch (error) {
      setState({ kind: "error", message: errorMessage(error) });
    }
  }, [authGateway, battleGateway, rosterRepository, searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pollingKey = state.kind === "room" ? state.room.key.join(".") : "";
  const pollingStatus = state.kind === "room" ? state.room.status : "finished";
  useEffect(() => {
    const key = parseKey(pollingKey);
    if (!key || pollingStatus === "finished") return;
    let active = true;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void battleGateway.read(key).then(
        (room) => {
          if (!active) return;
          setState((current) =>
            current.kind === "room" && room.version > current.room.version
              ? { ...current, room }
              : current,
          );
        },
        (error) => active && setMessage(errorMessage(error)),
      );
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [battleGateway, pollingKey, pollingStatus]);

  async function createRoom() {
    if (!selectedRosterId) return;
    setBusy(true);
    setMessage("");
    try {
      const room = await battleGateway.create(selectedRosterId);
      const current = state;
      if (current.kind !== "lobby") return;
      rememberRoom(room);
      setState({ ...current, kind: "room", room });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (!selectedRosterId || joinKey.length !== 3) return;
    setBusy(true);
    setMessage("");
    try {
      const room = await battleGateway.join(joinKey as RoomKey, selectedRosterId);
      const current = state;
      if (current.kind !== "lobby") return;
      rememberRoom(room);
      setState({ ...current, kind: "room", room });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function rememberRoom(room: BattleRoom) {
    const encoded = room.key.join(".");
    localStorage.setItem(activeBattleKey, encoded);
    setSearchParams({ key: encoded }, { replace: true });
  }

  async function leaveRoom() {
    if (state.kind !== "room") return;
    setBusy(true);
    try {
      await battleGateway.leave(state.room.key);
      localStorage.removeItem(activeBattleKey);
      setSearchParams({}, { replace: true });
      setState({ kind: "lobby", user: state.user, rosters: state.rosters });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <BattleLoading />;
  if (state.kind === "signed-out") return <BattleSignIn />;
  if (state.kind === "error")
    return <BattleError message={state.message} onRetry={() => void load()} />;
  if (state.kind === "room")
    return (
      <BattleTable
        busy={busy}
        catalogGateway={catalogGateway}
        gateway={battleGateway}
        message={message}
        onError={setMessage}
        onLeave={() => void leaveRoom()}
        onRoom={(room) => setState({ ...state, room })}
        room={state.room}
      />
    );
  return (
    <BattleLobby
      busy={busy}
      joinKey={joinKey}
      message={message}
      onCreate={() => void createRoom()}
      onJoin={() => void joinRoom()}
      onJoinKey={setJoinKey}
      onRoster={setSelectedRosterId}
      rosters={state.rosters}
      selectedRosterId={selectedRosterId}
    />
  );
}

function BattleLobby({
  busy,
  joinKey,
  message,
  onCreate,
  onJoin,
  onJoinKey,
  onRoster,
  rosters,
  selectedRosterId,
}: {
  readonly busy: boolean;
  readonly joinKey: readonly CriticalEffectId[];
  readonly message: string;
  readonly onCreate: () => void;
  readonly onJoin: () => void;
  readonly onJoinKey: (key: CriticalEffectId[]) => void;
  readonly onRoster: (id: string) => void;
  readonly rosters: readonly StoredRoster[];
  readonly selectedRosterId: string;
}) {
  return (
    <div className="battle-page battle-lobby">
      <header className="battle-hero">
        <div>
          <p className="eyebrow">Закрытый стол · два адмирала</p>
          <h1>Баталия</h1>
        </div>
        <p>
          Выберите сохранённый флот и поднимите сигнальные флаги. Состав фиксируется снимком на
          момент входа.
        </p>
      </header>
      {message ? (
        <p className="battle-message" role="alert">
          {message}
        </p>
      ) : null}
      {rosters.length === 0 ? (
        <section className="battle-empty">
          <span aria-hidden="true">∅</span>
          <h2>Нет готового флота</h2>
          <p>Сначала создайте и синхронизируйте с аккаунтом хотя бы один ростер.</p>
          <Link className="button" to="/rosters/new">
            Создать флот
          </Link>
        </section>
      ) : (
        <>
          <label className="battle-roster-picker">
            <span>Флот для баталии</span>
            <select value={selectedRosterId} onChange={(event) => onRoster(event.target.value)}>
              {rosters.map((roster) => (
                <option key={roster.id} value={roster.id}>
                  {roster.name} · {roster.faction.label} · {roster.limits.points} оч.
                </option>
              ))}
            </select>
          </label>
          <div className="battle-lobby-grid">
            <article className="battle-lobby-card battle-lobby-card--create">
              <span className="battle-card-index">01</span>
              <p className="eyebrow">Новая акватория</p>
              <h2>Создать комнату</h2>
              <p>
                Вы станете первым адмиралом. Комната получит ключ из трёх граней и закроется через
                24 часа.
              </p>
              <button className="button" disabled={busy} onClick={onCreate} type="button">
                {busy ? "Поднимаем флаги…" : "Создать баталию"}
              </button>
            </article>
            <article className="battle-lobby-card battle-lobby-card--join">
              <span className="battle-card-index">02</span>
              <p className="eyebrow">Получен сигнал</p>
              <h2>Войти по критам</h2>
              <KeySequence
                keyValue={joinKey}
                onRemove={(index) => onJoinKey(joinKey.filter((_, item) => item !== index))}
              />
              <CriticalPicker
                disabled={joinKey.length >= 3}
                onPick={(effect) => onJoinKey([...joinKey, effect])}
              />
              <button
                className="button button--secondary"
                disabled={busy || joinKey.length !== 3}
                onClick={onJoin}
                type="button"
              >
                Войти в комнату
              </button>
            </article>
          </div>
        </>
      )}
    </div>
  );
}

function BattleTable({
  busy,
  catalogGateway,
  gateway,
  message,
  onError,
  onLeave,
  onRoom,
  room,
}: {
  readonly busy: boolean;
  readonly catalogGateway: RosterCatalogGateway;
  readonly gateway: BattleGateway;
  readonly message: string;
  readonly onError: (message: string) => void;
  readonly onLeave: () => void;
  readonly onRoom: (room: BattleRoom) => void;
  readonly room: BattleRoom;
}) {
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);
  const own = room[room.you];
  if (!own) throw new Error("Your battle side is missing from the room.");
  const opponent = room[room.you === "host" ? "guest" : "host"];

  async function update(update: Parameters<BattleGateway["update"]>[2]) {
    setUpdating(true);
    onError("");
    try {
      onRoom(await gateway.update(room.key, room.version, update));
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setUpdating(false);
    }
  }

  async function copyInvite() {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ key: room.key.join(".") }).toString();
    await navigator.clipboard.writeText(
      `${room.key.map((key) => criticals[key].short).join(" · ")}\n${url}`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  const nextSide: BattleSide = room.activeSide === "host" ? "guest" : "host";
  return (
    <div className="battle-page battle-table" data-status={room.status}>
      <header className="battle-command-bar">
        <div className="battle-room-key">
          <span>Ключ комнаты</span>
          <KeySequence keyValue={room.key} />
          <button type="button" onClick={() => void copyInvite()}>
            {copied ? "Скопировано" : "Копировать приглашение"}
          </button>
        </div>
        <div className="battle-round">
          <span>Раунд</span>
          <strong>{room.round}</strong>
          <small>
            {room.status === "active"
              ? `Ход: ${room.activeSide === "host" ? room.host.displayName : room.guest?.displayName}`
              : "Подготовка флотов"}
          </small>
        </div>
        <div className="battle-command-actions">
          {room.status === "active" ? (
            <>
              <button
                disabled={updating || room.round <= 1}
                onClick={() =>
                  void update({ type: "round", round: room.round - 1, activeSide: nextSide })
                }
                type="button"
              >
                − Раунд
              </button>
              <button
                disabled={updating || room.round >= 20}
                onClick={() =>
                  void update({ type: "round", round: room.round + 1, activeSide: nextSide })
                }
                type="button"
              >
                Следующий раунд
              </button>
            </>
          ) : null}
          <button disabled={busy} onClick={onLeave} type="button">
            {room.you === "host" ? "Закрыть" : "Выйти"}
          </button>
        </div>
      </header>
      {message ? (
        <p className="battle-message" role="alert">
          {message}
        </p>
      ) : null}
      {room.status !== "active" ? (
        <section className="battle-ready-deck">
          <div>
            <p className="eyebrow">Сверка эскадр</p>
            <h1>{opponent ? "Флоты на линии" : "Ожидаем второго адмирала"}</h1>
          </div>
          <p>
            {opponent
              ? "Подтвердите готовность. После начала партии ростеры фиксируются."
              : "Передайте сопернику ключ из критических граней."}
          </p>
          <button
            className={own.ready ? "is-ready" : ""}
            disabled={!opponent || updating}
            onClick={() => void update({ type: "ready", ready: !own.ready })}
            type="button"
          >
            {own.ready ? "Готовность подтверждена" : "Флот готов"}
          </button>
        </section>
      ) : null}
      <main className="battle-fleets">
        <FleetLedger
          active={room.activeSide === "host"}
          catalogGateway={catalogGateway}
          editable={room.you === "host" && room.status === "active" && !updating}
          onShip={(shipId, state) => void update({ type: "ship", shipId, state })}
          player={room.host}
          side="host"
        />
        <FleetLedger
          active={room.activeSide === "guest"}
          catalogGateway={catalogGateway}
          editable={room.you === "guest" && room.status === "active" && !updating}
          onShip={(shipId, state) => void update({ type: "ship", shipId, state })}
          player={room.guest}
          side="guest"
        />
      </main>
      <p className="battle-sync" aria-live="polite">
        {updating ? "Передаём сигнал…" : `Синхронизировано · версия ${room.version}`}
      </p>
    </div>
  );
}

function FleetLedger({
  active,
  catalogGateway,
  editable,
  onShip,
  player,
  side,
}: {
  readonly active: boolean;
  readonly catalogGateway: RosterCatalogGateway;
  readonly editable: boolean;
  readonly onShip: (shipId: string, state: ShipBattleState) => void;
  readonly player: BattlePlayer | null;
  readonly side: BattleSide;
}) {
  const [catalog, setCatalog] = useState<DomainCatalog | null>(null);
  const [profile, setProfile] = useState<ShipEditorReadyReadModel | null>(null);
  useEffect(() => {
    if (!player) return;
    let activeRequest = true;
    void catalogGateway
      .load(player.roster.roster.catalogContentVersion, player.roster.faction.id)
      .then((value) => activeRequest && setCatalog(value));
    return () => {
      activeRequest = false;
    };
  }, [catalogGateway, player]);
  if (!player)
    return (
      <section className="fleet-ledger fleet-ledger--waiting">
        <span>II</span>
        <h2>Место свободно</h2>
        <p>Соперник войдёт по ключу комнаты.</p>
      </section>
    );
  const storedRoster = player.roster as unknown as StoredRoster;
  const units = catalog ? rosterUnits(storedRoster, catalog) : [];
  return (
    <>
      <section className={`fleet-ledger${active ? " fleet-ledger--active" : ""}`}>
        <header>
          <div>
            <p className="eyebrow">Адмирал {side === "host" ? "I" : "II"}</p>
            <h2>{player.displayName}</h2>
            <p>
              {player.roster.name} · {player.roster.faction.label}
            </p>
          </div>
          <span className={player.ready ? "ready" : ""}>{player.ready ? "Готов" : "Сбор"}</span>
        </header>
        {!catalog ? (
          <p className="fleet-ledger__loading">Поднимаем корабельные ведомости…</p>
        ) : units.length === 0 ? (
          <p className="fleet-ledger__loading">В ростере нет кораблей.</p>
        ) : (
          <div className="battle-ship-list">
            {units.map((unit) => (
              <ShipTracker
                editable={editable}
                key={unit.id}
                label={unit.label}
                onChange={(next) => onShip(unit.id, next)}
                {...(unit.profileAvailable
                  ? {
                      onOpenProfile: () => {
                        const projected = projectShipEditor(
                          storedRoster.roster,
                          catalog,
                          unit.id,
                          unit.definitionId,
                          "saved-local",
                        );
                        if (projected.dataState === "ready") setProfile(projected);
                      },
                    }
                  : {})}
                state={player.shipState[unit.id] ?? emptyShipState}
              />
            ))}
          </div>
        )}
      </section>
      {profile ? (
        <ShipProfileDialog
          faction={player.roster.faction.label}
          model={profile}
          name={profile.name}
          onClose={() => setProfile(null)}
          selectedLoadout
        />
      ) : null}
    </>
  );
}

function ShipTracker({
  editable,
  label,
  onChange,
  onOpenProfile,
  state,
}: {
  readonly editable: boolean;
  readonly label: string;
  readonly onChange: (state: ShipBattleState) => void;
  readonly onOpenProfile?: () => void;
  readonly state: ShipBattleState;
}) {
  const totalCriticals = Object.values(state.criticals).reduce((total, value) => total + value, 0);
  const patch = (value: Partial<ShipBattleState>) => onChange({ ...state, ...value });
  return (
    <details className={`battle-ship${state.destroyed ? " is-destroyed" : ""}`}>
      <summary>
        <span className="battle-ship__mark" aria-hidden="true">
          ◆
        </span>
        <span>
          <strong>{label}</strong>
          <small>
            {state.destroyed
              ? "Уничтожен"
              : state.withdrawn
                ? "Отступил"
                : state.crippled
                  ? "Повреждён"
                  : "Боеготов"}
          </small>
        </span>
        <span className="battle-ship__vitals">
          <i>DMG {state.damage}</i>
          <i>DIS {state.disorder}</i>
          <i>CRIT {totalCriticals}</i>
        </span>
      </summary>
      <div className="battle-ship__controls">
        {onOpenProfile ? (
          <button className="battle-ship__profile" onClick={onOpenProfile} type="button">
            <span>Профиль и выбранные пушки</span>
            <b aria-hidden="true">→</b>
          </button>
        ) : null}
        <Counter
          disabled={!editable}
          label="Damage"
          max={99}
          onValue={(damage) => patch({ damage })}
          value={state.damage}
        />
        <Counter
          disabled={!editable}
          label="Disorder"
          max={3}
          onValue={(disorder) => patch({ disorder })}
          value={state.disorder}
        />
        <div className="battle-critical-grid">
          {criticalEffectIds.map((effect) => (
            <Counter
              compact
              disabled={!editable}
              key={effect}
              label={criticals[effect].short}
              mark={criticals[effect].mark}
              max={20}
              onValue={(value) => patch({ criticals: { ...state.criticals, [effect]: value } })}
              value={state.criticals[effect] ?? 0}
            />
          ))}
        </div>
        <div className="battle-status-flags">
          {(
            [
              ["activated", "Активирован"],
              ["crippled", "Crippled"],
              ["destroyed", "Уничтожен"],
              ["withdrawn", "Отступил"],
            ] as const
          ).map(([key, text]) => (
            <button
              aria-pressed={state[key]}
              disabled={!editable}
              key={key}
              onClick={() => patch({ [key]: !state[key] })}
              type="button"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

function Counter({
  compact = false,
  disabled,
  label,
  mark,
  max,
  onValue,
  value,
}: {
  readonly compact?: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly mark?: string;
  readonly max: number;
  readonly onValue: (value: number) => void;
  readonly value: number;
}) {
  return (
    <div className={`battle-counter${compact ? " battle-counter--compact" : ""}`}>
      <span>
        {mark ? <b>{mark}</b> : null}
        {label}
      </span>
      <div>
        <button
          aria-label={`Уменьшить ${label}`}
          disabled={disabled || value <= 0}
          onClick={() => onValue(value - 1)}
          type="button"
        >
          −
        </button>
        <output>{value}</output>
        <button
          aria-label={`Увеличить ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onValue(value + 1)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}

function KeySequence({
  keyValue,
  onRemove,
}: {
  readonly keyValue: readonly CriticalEffectId[];
  readonly onRemove?: (index: number) => void;
}) {
  return (
    <div className="critical-key" aria-label="Ключ комнаты">
      {[0, 1, 2].map((index) => {
        const effect = keyValue[index];
        return effect ? (
          <button
            disabled={!onRemove}
            key={index}
            onClick={() => onRemove?.(index)}
            title={onRemove ? "Убрать грань" : criticals[effect].label}
            type="button"
          >
            <CriticalFace effect={effect} />
          </button>
        ) : (
          <span className="critical-key__empty" key={index}>
            <b aria-hidden="true">?</b>
            <small>Выберите грань</small>
          </span>
        );
      })}
    </div>
  );
}

function CriticalPicker({
  disabled,
  onPick,
}: {
  readonly disabled: boolean;
  readonly onPick: (effect: CriticalEffectId) => void;
}) {
  return (
    <div className="critical-picker" aria-label="Грани критического кубика">
      {criticalEffectIds.map((effect) => (
        <button
          disabled={disabled}
          key={effect}
          onClick={() => onPick(effect)}
          title={criticals[effect].label}
          type="button"
        >
          <CriticalFace effect={effect} />
        </button>
      ))}
    </div>
  );
}

function CriticalFace({ effect }: { readonly effect: CriticalEffectId }) {
  const face = criticals[effect];
  return (
    <span className="critical-face">
      <span className="critical-face__image">
        <img alt="" decoding="async" src={face.image} />
      </span>
      <span className="critical-face__label">{face.short}</span>
    </span>
  );
}

function BattleLoading() {
  return (
    <div className="battle-page battle-state">
      <span>◌</span>
      <h1>Открываем адмиральский стол</h1>
    </div>
  );
}
function BattleSignIn() {
  return (
    <div className="battle-page battle-state">
      <span>II</span>
      <p className="eyebrow">Закрытая акватория</p>
      <h1>Войдите для баталии</h1>
      <p>Комната закрепляется за аккаунтом и доступна только двум адмиралам.</p>
      <Link className="button" to="/settings#account-title">
        Войти в аккаунт
      </Link>
    </div>
  );
}
function BattleError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="battle-page battle-state">
      <span>!</span>
      <h1>Сигнал потерян</h1>
      <p>{message}</p>
      <button className="button" onClick={onRetry} type="button">
        Повторить
      </button>
    </div>
  );
}

function rosterUnits(roster: StoredRoster, catalog: DomainCatalog) {
  return Object.values(roster.roster.instances)
    .filter((instance) => catalog.entities[instance.definitionId]?.kind === "Unit")
    .map((instance) => ({
      definitionId: instance.definitionId,
      id: instance.id,
      label: `${catalog.entities[instance.definitionId]?.label.plainText || "Корабль"}${instance.quantity > 1 ? ` ×${instance.quantity}` : ""}`,
      profileAvailable: isShipEditorDefinition(catalog, instance.definitionId),
    }));
}

function parseKey(value: string): RoomKey | null {
  const parts = value.toLocaleLowerCase("en").split(".");
  return parts.length === 3 &&
    parts.every((part) => criticalEffectIds.includes(part as CriticalEffectId))
    ? (parts as RoomKey)
    : null;
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось связаться с комнатой.";
}
