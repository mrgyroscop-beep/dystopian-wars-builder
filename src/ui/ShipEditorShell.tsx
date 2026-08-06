import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";

import type {
  ShipEditorCommand,
  ShipEditorGroupId,
  ShipEditorGroupReadModel,
  ShipEditorOptionReadModel,
  ShipEditorReadyReadModel,
  ShipEditorReadModel,
} from "../application/rosters/ship-editor";
import type { WeaponProfileReadModel } from "../application/rosters/profile-rules";
import { EyeIcon } from "./EyeIcon";
import { WeaponProfileDialog } from "./ProfileDialog";
import { ProfilePanel, RuleSheet, RulesPanel } from "./ProfileRules";

type EditorTab = "configuration" | "profile" | "rules";

const editorTabs = [
  ["configuration", "Настройка"],
  ["profile", "Профиль"],
  ["rules", "Правила"],
] as const;

export function ShipEditorShell({
  busy,
  model,
  onAdd,
  onBack,
  onCommand,
  onOpenRule,
  onRuleBack,
  ruleId,
}: {
  readonly busy: boolean;
  readonly model: ShipEditorReadModel;
  readonly onAdd: () => void;
  readonly onBack: () => void;
  readonly onCommand: (command: ShipEditorCommand, announcement: string) => void;
  readonly onOpenRule?: (ruleId: string) => void;
  readonly onRuleBack?: () => void;
  readonly ruleId?: string | null;
}) {
  const [tab, setTab] = useState<EditorTab>(ruleId ? "rules" : "configuration");
  const [fleetEditorOpen, setFleetEditorOpen] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<ShipEditorGroupId | null>(() =>
    model.dataState === "ready" ? (model.groups[0]?.id ?? null) : null,
  );
  const [localRuleId, setLocalRuleId] = useState<string | null>(null);
  const [inspectedWeapon, setInspectedWeapon] = useState<WeaponProfileReadModel | null>(null);
  const ruleReturn = useRef<RuleReturn | null>(null);
  const tabsId = useId();
  const activeRuleId = ruleId === undefined ? localRuleId : ruleId;
  const previousActiveRuleId = useRef<string | null>(activeRuleId);
  const visibleTab: EditorTab = activeRuleId ? "rules" : tab;

  useEffect(() => {
    if (previousActiveRuleId.current && !activeRuleId) restoreRuleReturn(ruleReturn);
    previousActiveRuleId.current = activeRuleId;
  }, [activeRuleId]);

  function focusGroup(groupId: ShipEditorGroupId | null) {
    if (!groupId || model.dataState !== "ready") return;
    setOpenGroupId(groupId);
    requestAnimationFrame(() => {
      const target = document.getElementById(groupDomId(model, groupId));
      if (target && "scrollIntoView" in target) target.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    });
  }

  function selectTab(next: EditorTab) {
    setTab(next);
    document.getElementById(`${tabsId}-${next}-tab`)?.focus();
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: EditorTab) {
    const currentIndex = editorTabs.findIndex(([value]) => value === current);
    const lastIndex = editorTabs.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % editorTabs.length
            : event.key === "ArrowLeft"
              ? (currentIndex - 1 + editorTabs.length) % editorTabs.length
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(editorTabs[nextIndex]![0]);
  }

  function openRule(nextRuleId: string, returnElement: HTMLElement) {
    const scrollContainer = returnElement.closest<HTMLElement>(".context-pane");
    ruleReturn.current = {
      element: returnElement,
      scrollContainer,
      scrollTop: scrollContainer?.scrollTop ?? null,
      scrollY: window.scrollY,
    };
    setTab("rules");
    if (onOpenRule) onOpenRule(nextRuleId);
    else setLocalRuleId(nextRuleId);
  }

  function closeRule() {
    if (onRuleBack) onRuleBack();
    else setLocalRuleId(null);
  }

  if (model.dataState !== "ready")
    return (
      <article className="ship-editor ship-editor--unavailable" aria-labelledby="ship-editor-title">
        <header className="ship-editor__masthead">
          <div>
            <p className="preview-category">Состояние данных</p>
            <h3 id="ship-editor-title" tabIndex={-1}>
              {model.title}
            </h3>
          </div>
          <button className="editor-back" onClick={onBack} type="button">
            ← Назад
          </button>
        </header>
        <p role="status">{model.detail}</p>
      </article>
    );

  return (
    <article className="ship-editor" data-mode={model.mode} aria-labelledby="ship-editor-title">
      <div className="ship-editor__chrome">
        <header className="ship-editor__masthead">
          <div>
            <p className="preview-category">{model.mode === "preview" ? "Preview" : "В составе"}</p>
            <h3 id="ship-editor-title" tabIndex={-1}>
              {model.name}
            </h3>
          </div>
          <div className="ship-editor__masthead-actions">
            <span className="editor-mode-badge">
              {model.mode === "preview" ? "Только чтение" : "Редактирование"}
            </span>
            <button className="editor-back" onClick={onBack} type="button">
              ← Назад
            </button>
          </div>
        </header>

        <dl className="ship-editor__summary" aria-label="Сводка корабля">
          <div>
            <dt>Points</dt>
            <dd>
              <strong>{model.totalPoints}</strong>
              <small>
                {model.basePoints} база · {signed(model.optionPoints)} опции
              </small>
            </dd>
          </div>
          <div>
            <dt>VPR</dt>
            <dd>
              <strong>{model.victoryPoints}</strong>
              <small>фиксировано</small>
            </dd>
          </div>
          <div data-state={model.validity}>
            <dt>Обязательные</dt>
            <dd>
              <strong>
                {model.mandatory.selected} / {model.mandatory.required}
              </strong>
              <small>{model.validity === "valid" ? "готово" : "нужна настройка"}</small>
            </dd>
          </div>
        </dl>

        <div className="ship-editor__axes" aria-label="Состояние редактора">
          <EditorAxis label="Состав" value={model.validity} />
          <EditorAxis label="Сохранение" value={model.persistence} />
          <EditorAxis label="Система" value={model.system} />
        </div>

        {model.mode === "preview" ? (
          <div className="preview-primary-action">
            <button className="button preview-add" disabled={busy} onClick={onAdd} type="button">
              Добавить в состав
            </button>
            <small>Корабль будет добавлен с минимальной базовой комплектацией.</small>
          </div>
        ) : null}

        <div className="editor-tabs" role="tablist" aria-label="Раздел корабля">
          {editorTabs.map(([value, label]) => (
            <button
              aria-controls={`${tabsId}-${value}`}
              aria-selected={visibleTab === value}
              id={`${tabsId}-${value}-tab`}
              key={value}
              onClick={() => setTab(value)}
              onKeyDown={(event) => handleTabKey(event, value)}
              role="tab"
              tabIndex={visibleTab === value ? 0 : -1}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visibleTab === "configuration" ? (
        <section
          aria-labelledby={`${tabsId}-configuration-tab`}
          className="ship-editor__configuration"
          id={`${tabsId}-configuration`}
          role="tabpanel"
        >
          <section className="model-quantity" aria-label="Количество моделей">
            <div>
              <strong>Model</strong>
              <small>Структурная модель корабля</small>
            </div>
            {model.modelQuantity.fixed ? (
              <span>{model.modelQuantity.value} (фиксировано)</span>
            ) : (
              <label>
                <span>Количество</span>
                <input
                  disabled={busy || model.mode === "preview"}
                  max={model.modelQuantity.maximum}
                  min={model.modelQuantity.minimum}
                  onChange={(event) =>
                    model.modelQuantity.instanceId &&
                    onCommand(
                      {
                        type: "set-model-quantity",
                        instanceId: model.modelQuantity.instanceId,
                        quantity: event.currentTarget.valueAsNumber,
                      },
                      `Model: ${event.currentTarget.valueAsNumber}.`,
                    )
                  }
                  type="number"
                  value={model.modelQuantity.value}
                />
              </label>
            )}
          </section>

          <div className="editor-groups">
            {model.groups.map((group, groupIndex) => (
              <EditorGroup
                busy={busy}
                domId={`ship-editor-group-unit-${groupIndex}`}
                group={group}
                key={group.id}
                model={model}
                nameToken={`unit-${groupIndex}`}
                onCommand={onCommand}
                onInspectWeapon={setInspectedWeapon}
                onToggle={() =>
                  setOpenGroupId((current) => (current === group.id ? null : group.id))
                }
                open={openGroupId === group.id}
              />
            ))}
          </div>

          <section className="derived-breakdown" aria-labelledby={`${tabsId}-breakdown-title`}>
            <h4 id={`${tabsId}-breakdown-title`}>Расчёт Points</h4>
            <dl>
              {model.breakdown.map((line) => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {model.fleetGroups.length ? (
            <>
              <section className="doctrine-navigation" id="fleet-doctrine">
                <div>
                  <h4>Доктрина флота</h4>
                  <p>Доктрина принадлежит Battlefleet и настраивается на уровне состава.</p>
                </div>
                <button
                  aria-controls="fleet-doctrine-editor"
                  aria-expanded={fleetEditorOpen}
                  onClick={() => setFleetEditorOpen((value) => !value)}
                  type="button"
                >
                  {fleetEditorOpen ? "Закрыть настройки" : "Настроить доктрину"}
                </button>
              </section>

              {fleetEditorOpen ? (
                <section
                  aria-label="Настройка доктрины флота"
                  className="fleet-doctrine-editor editor-groups"
                  id="fleet-doctrine-editor"
                >
                  {model.fleetGroups.map((group, groupIndex) => (
                    <EditorGroup
                      busy={busy}
                      domId={`ship-editor-group-fleet-${groupIndex}`}
                      group={group}
                      key={group.id}
                      model={model}
                      nameToken={`fleet-${groupIndex}`}
                      onCommand={onCommand}
                      onInspectWeapon={setInspectedWeapon}
                      onToggle={() =>
                        setOpenGroupId((current) => (current === group.id ? null : group.id))
                      }
                      open={openGroupId === group.id}
                    />
                  ))}
                </section>
              ) : null}
            </>
          ) : null}

          {model.problems.length ? (
            <section className="editor-problems" aria-labelledby={`${tabsId}-problems-title`}>
              <h4 id={`${tabsId}-problems-title`}>Что исправить</h4>
              <ul>
                {model.problems.map((problem) => (
                  <li key={problem.id}>
                    <button onClick={() => focusGroup(problem.targetGroupId)} type="button">
                      <strong>{problem.title}</strong>
                      <span>{problem.detail}</span>
                      <em>Перейти к {problem.targetGroupLabel} →</em>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : visibleTab === "profile" ? (
        <section
          aria-labelledby={`${tabsId}-profile-tab`}
          className="ship-editor__profile"
          id={`${tabsId}-profile`}
          role="tabpanel"
        >
          <ProfilePanel model={model.profileRules} onInspectWeapon={setInspectedWeapon} />
        </section>
      ) : (
        <section
          aria-labelledby={`${tabsId}-rules-tab`}
          className="ship-editor__rules"
          id={`${tabsId}-rules`}
          role="tabpanel"
        >
          <div hidden={Boolean(activeRuleId)}>
            <RulesPanel model={model.profileRules} onOpenRule={openRule} />
          </div>
          {activeRuleId ? (
            <RuleSheet
              model={model.profileRules}
              onBack={closeRule}
              onOpenRule={openRule}
              ruleId={activeRuleId}
            />
          ) : null}
        </section>
      )}
      {inspectedWeapon ? (
        <WeaponProfileDialog onClose={() => setInspectedWeapon(null)} profile={inspectedWeapon} />
      ) : null}
    </article>
  );
}

function OptionCopy({ option }: { readonly option: ShipEditorOptionReadModel }) {
  return (
    <span className="editor-option__copy">
      <span>
        <strong>{option.label}</strong>
        <small>{option.kind}</small>
      </span>
      <span>
        <b>{option.costLabel}</b>
        {option.reason ? <small>{option.reason}</small> : null}
      </span>
    </span>
  );
}

function groupDomId(model: ShipEditorReadyReadModel, groupId: ShipEditorGroupId): string {
  const unitIndex = model.groups.findIndex((group) => group.id === groupId);
  if (unitIndex >= 0) return `ship-editor-group-unit-${unitIndex}`;
  const fleetIndex = model.fleetGroups.findIndex((group) => group.id === groupId);
  return fleetIndex >= 0 ? `ship-editor-group-fleet-${fleetIndex}` : "ship-editor-title";
}

function EditorGroup({
  busy,
  domId,
  group,
  model,
  nameToken,
  onCommand,
  onInspectWeapon,
  onToggle,
  open,
}: {
  readonly busy: boolean;
  readonly domId: string;
  readonly group: ShipEditorGroupReadModel;
  readonly model: ShipEditorReadyReadModel;
  readonly nameToken: string;
  readonly onCommand: (command: ShipEditorCommand, announcement: string) => void;
  readonly onInspectWeapon: (profile: WeaponProfileReadModel) => void;
  readonly onToggle: () => void;
  readonly open: boolean;
}) {
  const selected = group.options.filter((option) => option.selectedQuantity > 0);
  const selectedCount = selected.reduce((sum, option) => sum + option.selectedQuantity, 0);
  const summary = selected.length
    ? selected
        .map((option) =>
          option.selectedQuantity > 1
            ? `${option.label} ×${option.selectedQuantity}`
            : option.label,
        )
        .join(", ")
    : group.minimum > 0
      ? "Требуется выбор"
      : "Без опций";
  return (
    <section
      aria-labelledby={`${domId}-title`}
      className="editor-group"
      data-open={open}
      id={domId}
      role="group"
      tabIndex={-1}
    >
      <button
        aria-expanded={open}
        className="editor-group__summary"
        id={`${domId}-title`}
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden="true" className="editor-group__chevron">
          {open ? "▾" : "▸"}
        </span>
        <span>
          <strong>{group.label}</strong>
          <small>
            {selectedCount}/{group.maximum}
          </small>
        </span>
        <em>{summary}</em>
      </button>
      {open ? (
        <div className="editor-group__body">
          <p>{group.help}</p>
          {group.options.map((option) =>
            group.control === "exclusive" ? (
              <div
                className="editor-option"
                data-availability={option.availability}
                key={option.id}
              >
                <label className="editor-option__choice">
                  <input
                    checked={option.selectedQuantity === 1}
                    disabled={
                      busy || model.mode === "preview" || option.availability !== "available"
                    }
                    name={`ship-${nameToken}`}
                    onChange={() =>
                      model.instanceId &&
                      onCommand(
                        {
                          type: "replace-exclusive",
                          instanceId: model.instanceId,
                          groupId: group.id,
                          optionId: option.id,
                        },
                        `${group.label}: выбрано ${option.label}.`,
                      )
                    }
                    type="radio"
                  />
                  <OptionCopy option={option} />
                </label>
                {option.profile ? (
                  <button
                    aria-label={`Показать свойства ${option.label}`}
                    className="option-inspect"
                    onClick={() => option.profile && onInspectWeapon(option.profile)}
                    type="button"
                  >
                    <EyeIcon />
                  </button>
                ) : null}
              </div>
            ) : (
              <div
                className="editor-option editor-option--quantity"
                data-availability={option.availability}
                key={option.id}
              >
                <OptionCopy option={option} />
                <input
                  aria-label={`Количество ${option.label}`}
                  disabled={busy || model.mode === "preview" || option.availability !== "available"}
                  max={group.maximum}
                  min={group.minimum}
                  onChange={(event) =>
                    model.instanceId &&
                    onCommand(
                      {
                        type: "set-choice-quantity",
                        instanceId: model.instanceId,
                        groupId: group.id,
                        optionId: option.id,
                        quantity: event.currentTarget.valueAsNumber,
                      },
                      `${group.label}: ${event.currentTarget.valueAsNumber} из ${group.maximum}.`,
                    )
                  }
                  type="number"
                  value={option.selectedQuantity}
                />
                {option.profile ? (
                  <button
                    aria-label={`Показать свойства ${option.label}`}
                    className="option-inspect"
                    onClick={() => option.profile && onInspectWeapon(option.profile)}
                    type="button"
                  >
                    <EyeIcon />
                  </button>
                ) : null}
              </div>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

function signed(value: string): string {
  return Number(value) > 0 ? `+${value}` : value;
}

function EditorAxis({ label, value }: { readonly label: string; readonly value: string }) {
  const detail = axisLabel(value);
  return (
    <span data-state={value}>
      <span aria-hidden="true" className="editor-axis__icon">
        {axisIcon(value)}
      </span>
      <strong>{label}</strong>
      <small className="editor-axis__detail">{detail}</small>
    </span>
  );
}

function axisIcon(value: string): string {
  if (["valid", "saved-local", "ready"].includes(value)) return "✓";
  if (["invalid", "save-error", "unavailable"].includes(value)) return "!";
  return "↻";
}

function axisLabel(value: string): string {
  const labels: Record<string, string> = {
    valid: "готов",
    invalid: "есть ошибки",
    indeterminate: "не определён",
    "saved-local": "на устройстве",
    unsaved: "не сохранено",
    saving: "сохраняется",
    "save-error": "ошибка",
    ready: "доступна",
    unavailable: "недоступна",
  };
  return labels[value] ?? value;
}

interface RuleReturn {
  readonly element: HTMLElement;
  readonly scrollContainer: HTMLElement | null;
  readonly scrollTop: number | null;
  readonly scrollY: number;
}

function restoreRuleReturn(ruleReturn: MutableRefObject<RuleReturn | null>) {
  const target = ruleReturn.current;
  ruleReturn.current = null;
  requestAnimationFrame(() => {
    if (target?.scrollContainer?.isConnected && target.scrollTop !== null)
      target.scrollContainer.scrollTop = target.scrollTop;
    if (target?.element.isConnected) target.element.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>(".rule-list button")?.focus({ preventScroll: true });
    if (target) window.scrollTo({ top: target.scrollY });
  });
}
