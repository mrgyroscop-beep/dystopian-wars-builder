import { useId, useState } from "react";

import type {
  ShipEditorCommand,
  ShipEditorGroupId,
  ShipEditorReadModel,
} from "../application/rosters/ship-editor";

type EditorTab = "configuration" | "profile" | "rules";

export function ShipEditorShell({
  busy,
  model,
  onAdd,
  onCommand,
}: {
  readonly busy: boolean;
  readonly model: ShipEditorReadModel;
  readonly onAdd: () => void;
  readonly onCommand: (command: ShipEditorCommand, announcement: string) => void;
}) {
  const [tab, setTab] = useState<EditorTab>("configuration");
  const tabsId = useId();

  function focusGroup(groupId: ShipEditorGroupId) {
    const target = document.getElementById(`ship-editor-group-${groupId}`);
    if (target && "scrollIntoView" in target) target.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }

  return (
    <article className="ship-editor" data-mode={model.mode} aria-labelledby="ship-editor-title">
      <header className="ship-editor__masthead">
        <div>
          <p className="preview-category">{model.mode === "preview" ? "Preview" : "В составе"}</p>
          <h3 id="ship-editor-title">{model.name}</h3>
        </div>
        <span className="editor-mode-badge">
          {model.mode === "preview" ? "Только чтение" : "Редактирование"}
        </span>
      </header>

      <dl className="ship-editor__summary" aria-label="Сводка корабля">
        <div>
          <dt>Points</dt>
          <dd>
            <strong>{model.totalPoints}</strong>
            <small>350 база · {signed(model.optionPoints)} опции</small>
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
        {(
          [
            ["configuration", "Настройка"],
            ["profile", "Профиль"],
            ["rules", "Правила"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-controls={`${tabsId}-${value}`}
            aria-selected={tab === value}
            id={`${tabsId}-${value}-tab`}
            key={value}
            onClick={() => setTab(value)}
            role="tab"
            tabIndex={tab === value ? 0 : -1}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "configuration" ? (
        <section
          aria-labelledby={`${tabsId}-configuration-tab`}
          className="ship-editor__configuration"
          id={`${tabsId}-configuration`}
          role="tabpanel"
        >
          {model.problems.length ? (
            <section className="editor-problems" aria-labelledby={`${tabsId}-problems-title`}>
              <h4 id={`${tabsId}-problems-title`}>Что исправить</h4>
              <ul>
                {model.problems.map((problem) => (
                  <li key={problem.id}>
                    <button onClick={() => focusGroup(problem.targetGroupId)} type="button">
                      <strong>{problem.title}</strong>
                      <span>{problem.detail}</span>
                      <em>Перейти к {problem.targetGroupId.toUpperCase()} →</em>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="editor-groups">
            {model.groups.map((group) => (
              <fieldset
                className="editor-group"
                disabled={busy || model.mode === "preview"}
                id={`ship-editor-group-${group.id}`}
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
                        name={`ship-${model.instanceId ?? "preview"}-${group.id}`}
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
            <a href="#workspace-summary">К сводке флота ↑</a>
          </section>

          {model.mode === "preview" ? (
            <button className="button preview-add" disabled={busy} onClick={onAdd} type="button">
              Добавить в состав
            </button>
          ) : null}
        </section>
      ) : (
        <section
          aria-labelledby={`${tabsId}-${tab}-tab`}
          className="editor-unsupported"
          id={`${tabsId}-${tab}`}
          role="tabpanel"
        >
          <strong>{tab === "profile" ? "Профиль" : "Правила"} пока недоступны</strong>
          <p>Контент этого раздела будет подключён в KAN-36. Настройки корабля не потеряны.</p>
        </section>
      )}
    </article>
  );
}

function OptionCopy({
  option,
}: {
  readonly option: ShipEditorReadModel["groups"][number]["options"][number];
}) {
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
