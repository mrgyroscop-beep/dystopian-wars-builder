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
  const [localRuleId, setLocalRuleId] = useState<string | null>(null);
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
    const target = document.getElementById(groupDomId(model, groupId));
    if (target && "scrollIntoView" in target) target.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
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
            <dt>VP</dt>
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
          <span data-state={model.validity}>Состав: {axisLabel(model.validity)}</span>
          <span data-state={model.persistence}>Сохранение: {axisLabel(model.persistence)}</span>
          <span data-state={model.system}>Система: {axisLabel(model.system)}</span>
        </div>

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

          <div className="editor-groups">
            {model.groups.map((group, groupIndex) => (
              <fieldset
                className="editor-group"
                disabled={busy || model.mode === "preview"}
                id={`ship-editor-group-unit-${groupIndex}`}
                key={group.id}
                tabIndex={-1}
              >
                <legend>
                  <span>{group.label}</span>
                  <small>
                    {group.minimum}–{group.maximum}
                  </small>
                </legend>
                <p>{group.help}</p>
                {group.options.map((option) => {
                  const unavailable = option.availability !== "available";
                  return group.control === "exclusive" ? (
                    <label
                      className="editor-option"
                      data-availability={option.availability}
                      key={option.id}
                    >
                      <input
                        checked={option.selectedQuantity === 1}
                        disabled={unavailable}
                        name={`ship-unit-${groupIndex}`}
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
                  ) : (
                    <label
                      className="editor-option editor-option--quantity"
                      data-availability={option.availability}
                      key={option.id}
                    >
                      <OptionCopy option={option} />
                      <input
                        aria-label={`Количество ${option.label}`}
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
                    </label>
                  );
                })}
              </fieldset>
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

          <section className="doctrine-navigation" id="fleet-doctrine">
            <div>
              <h4>Доктрина флота</h4>
              <p>Доктрина принадлежит Battlefleet и настраивается на уровне состава.</p>
            </div>
            <button
              aria-controls="fleet-doctrine-editor"
              aria-expanded={fleetEditorOpen}
              disabled={model.fleetGroups.length === 0}
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
                />
              ))}
            </section>
          ) : null}

          {model.mode === "preview" ? (
            <button className="button preview-add" disabled={busy} onClick={onAdd} type="button">
              Добавить в состав
            </button>
          ) : null}
        </section>
      ) : visibleTab === "profile" ? (
        <section
          aria-labelledby={`${tabsId}-profile-tab`}
          className="ship-editor__profile"
          id={`${tabsId}-profile`}
          role="tabpanel"
        >
          <ProfilePanel model={model.profileRules} />
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
}: {
  readonly busy: boolean;
  readonly domId: string;
  readonly group: ShipEditorGroupReadModel;
  readonly model: ShipEditorReadyReadModel;
  readonly nameToken: string;
  readonly onCommand: (command: ShipEditorCommand, announcement: string) => void;
}) {
  return (
    <fieldset
      className="editor-group"
      disabled={busy || model.mode === "preview"}
      id={domId}
      tabIndex={-1}
    >
      <legend>
        <span>{group.label}</span>
        <small>
          {group.minimum}–{group.maximum}
        </small>
      </legend>
      <p>{group.help}</p>
      {group.options.map((option) =>
        group.control === "exclusive" ? (
          <label className="editor-option" data-availability={option.availability} key={option.id}>
            <input
              checked={option.selectedQuantity === 1}
              disabled={option.availability !== "available"}
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
        ) : (
          <label
            className="editor-option editor-option--quantity"
            data-availability={option.availability}
            key={option.id}
          >
            <OptionCopy option={option} />
            <input
              aria-label={`Количество ${option.label}`}
              disabled={option.availability !== "available"}
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
          </label>
        ),
      )}
    </fieldset>
  );
}

function signed(value: string): string {
  return Number(value) > 0 ? `+${value}` : value;
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
