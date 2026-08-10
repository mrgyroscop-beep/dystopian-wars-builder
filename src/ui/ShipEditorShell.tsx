import { useState } from "react";

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
import { useRuleTranslation } from "./GlossaryContext";
import { OptionDescriptionDialog, WeaponProfileDialog } from "./ProfileDialog";

export function ShipEditorShell({
  busy,
  model,
  onAdd,
  onBack,
  onCommand,
}: {
  readonly busy: boolean;
  readonly model: ShipEditorReadModel;
  readonly onAdd: () => void;
  readonly onBack: () => void;
  readonly onCommand: (command: ShipEditorCommand, announcement: string) => void;
}) {
  const [openGroupId, setOpenGroupId] = useState<ShipEditorGroupId | null>(() =>
    model.dataState === "ready" ? (model.groups[0]?.id ?? null) : null,
  );
  const [inspectedWeapon, setInspectedWeapon] = useState<WeaponProfileReadModel | null>(null);
  const [inspectedOption, setInspectedOption] = useState<{
    readonly description: string;
    readonly name: string;
  } | null>(null);

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
          <button aria-label="Назад" className="editor-back" onClick={onBack} type="button">
            <span aria-hidden="true">←</span>
          </button>
        </header>
        <p role="status">{model.detail}</p>
      </article>
    );

  return (
    <article className="ship-editor" data-mode={model.mode} aria-labelledby="ship-editor-title">
      <div className="ship-editor__chrome">
        <header className="ship-editor__masthead">
          <div className="ship-editor__identity">
            <p className="preview-category">{model.mode === "preview" ? "Preview" : "В составе"}</p>
            <h3 id="ship-editor-title" tabIndex={-1}>
              {model.name}
            </h3>
          </div>
          <dl className="ship-editor__summary" aria-label="Сводка корабля">
            <div>
              <dt>Points</dt>
              <dd>
                <strong>{model.totalPoints}</strong>
              </dd>
            </div>
            <div>
              <dt>VPR</dt>
              <dd>
                <strong>{model.victoryPoints}</strong>
              </dd>
            </div>
          </dl>
          <button aria-label="Назад" className="editor-back" onClick={onBack} type="button">
            <span aria-hidden="true">←</span>
          </button>
        </header>

        {model.mode === "preview" ? (
          <div className="preview-primary-action">
            <button className="button preview-add" disabled={busy} onClick={onAdd} type="button">
              Добавить в состав
            </button>
            <small>Корабль будет добавлен с минимальной базовой комплектацией.</small>
          </div>
        ) : null}
      </div>

      <section className="ship-editor__configuration" aria-label="Настройка корабля">
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
              onInspectOption={(name, description) => setInspectedOption({ description, name })}
              onInspectWeapon={setInspectedWeapon}
              onToggle={() => setOpenGroupId((current) => (current === group.id ? null : group.id))}
              open={openGroupId === group.id}
            />
          ))}
        </div>

        <section className="derived-breakdown" aria-labelledby="ship-editor-breakdown-title">
          <h4 id="ship-editor-breakdown-title">Расчёт Points</h4>
          <dl>
            {model.breakdown.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </section>
      {inspectedWeapon ? (
        <WeaponProfileDialog onClose={() => setInspectedWeapon(null)} profile={inspectedWeapon} />
      ) : null}
      {inspectedOption ? (
        <OptionDescriptionDialog
          description={inspectedOption.description}
          name={inspectedOption.name}
          onClose={() => setInspectedOption(null)}
        />
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

function EditorGroup({
  busy,
  domId,
  group,
  model,
  nameToken,
  onCommand,
  onInspectOption,
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
  readonly onInspectOption: (name: string, description: string) => void;
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
            group.maximum === 1 ? (
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
                <OptionInspect
                  onInspectOption={onInspectOption}
                  onInspectWeapon={onInspectWeapon}
                  option={option}
                />
                <OptionTraitLink onInspectOption={onInspectOption} option={option} />
              </div>
            ) : (
              <div
                className="editor-option editor-option--quantity"
                data-availability={option.availability}
                key={option.id}
              >
                <OptionCopy option={option} />
                <div className="quantity-stepper">
                  <button
                    aria-label={`Уменьшить количество ${option.label}`}
                    disabled={
                      busy ||
                      model.mode === "preview" ||
                      option.availability !== "available" ||
                      option.selectedQuantity <= group.minimum
                    }
                    onClick={() =>
                      model.instanceId &&
                      onCommand(
                        {
                          type: "set-choice-quantity",
                          instanceId: model.instanceId,
                          groupId: group.id,
                          optionId: option.id,
                          quantity: option.selectedQuantity - 1,
                        },
                        `${group.label}: ${option.selectedQuantity - 1} из ${group.maximum}.`,
                      )
                    }
                    type="button"
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <output aria-label={`Выбрано ${option.selectedQuantity}`}>
                    {option.selectedQuantity}
                  </output>
                  <button
                    aria-label={`Увеличить количество ${option.label}`}
                    disabled={
                      busy ||
                      model.mode === "preview" ||
                      option.availability !== "available" ||
                      option.selectedQuantity >= group.maximum
                    }
                    onClick={() =>
                      model.instanceId &&
                      onCommand(
                        {
                          type: "set-choice-quantity",
                          instanceId: model.instanceId,
                          groupId: group.id,
                          optionId: option.id,
                          quantity: option.selectedQuantity + 1,
                        },
                        `${group.label}: ${option.selectedQuantity + 1} из ${group.maximum}.`,
                      )
                    }
                    type="button"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

function OptionInspect({
  onInspectOption,
  onInspectWeapon,
  option,
}: {
  readonly onInspectOption: (name: string, description: string) => void;
  readonly onInspectWeapon: (profile: WeaponProfileReadModel) => void;
  readonly option: ShipEditorOptionReadModel;
}) {
  if (option.trait || (!option.profile && !option.description)) return null;
  return (
    <button
      aria-label={`Показать свойства ${option.label}`}
      className="option-inspect"
      onClick={() =>
        option.profile
          ? onInspectWeapon(option.profile)
          : option.description && onInspectOption(option.label, option.description)
      }
      type="button"
    >
      <EyeIcon />
    </button>
  );
}

function OptionTraitLink({
  onInspectOption,
  option,
}: {
  readonly onInspectOption: (name: string, description: string) => void;
  readonly option: ShipEditorOptionReadModel;
}) {
  const trait = option.trait;
  if (option.selectedQuantity !== 1 || !trait) return null;
  return <LocalizedOptionTraitLink onInspectOption={onInspectOption} trait={trait} />;
}

function LocalizedOptionTraitLink({
  onInspectOption,
  trait,
}: {
  readonly onInspectOption: (name: string, description: string) => void;
  readonly trait: NonNullable<ShipEditorOptionReadModel["trait"]>;
}) {
  const localized = useRuleTranslation(trait.label);
  const translation = localized.language === "ru" ? localized.translation : null;
  const label = translation?.title ?? trait.label;
  const description = translation?.text ?? trait.description;
  return (
    <button
      aria-label={`Показать описание трейта ${label}`}
      className="editor-option__trait ship-card__trait"
      onClick={() => onInspectOption(label, description)}
      type="button"
    >
      Трейт: {label}
    </button>
  );
}
