import { useId, useState } from "react";

import type {
  BattlefleetForceReadModel,
  BattlefleetRuleReadModel,
} from "../application/rosters/workspace";
import { useRuleTranslation } from "./GlossaryContext";

export function BattlefleetPropertiesPanel({
  force,
}: {
  readonly force: BattlefleetForceReadModel;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { properties } = force;
  const requiredLabel = properties.requiredElements
    ? `${properties.completedRequiredElements}/${properties.requiredElements} обязательных`
    : "без обязательных элементов";

  return (
    <section className="battlefleet-properties" aria-labelledby={`${panelId}-title`}>
      <button
        aria-controls={`${panelId}-content`}
        aria-expanded={open}
        className="battlefleet-properties__toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="battlefleet-properties__mark" aria-hidden="true">
          BF
        </span>
        <span className="battlefleet-properties__copy">
          <span className="eyebrow">Свойства Battlefleet</span>
          <strong id={`${panelId}-title`}>{force.label}</strong>
          <small>
            {properties.rules[0] ? (
              <>
                Бонус: <BattlefleetRuleTitle rule={properties.rules[0]} /> · {requiredLabel} ·{" "}
                {shipCountLabel(properties.shipCount)}
              </>
            ) : (
              <>
                Бонус не указан · {requiredLabel} · {shipCountLabel(properties.shipCount)}
              </>
            )}
          </small>
        </span>
        <span className="battlefleet-properties__chevron" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div className="battlefleet-properties__content" id={`${panelId}-content`}>
          <p className="battlefleet-properties__summary">{properties.summary}</p>

          <section className="battlefleet-properties__section">
            <h4>Организация флота</h4>
            {properties.elements.length ? (
              <ul className="battlefleet-properties__elements">
                {properties.elements.map((element) => {
                  const complete = element.selected >= element.minimum;
                  const exceeded = element.maximum !== null && element.selected > element.maximum;
                  return (
                    <li
                      data-state={exceeded ? "error" : complete ? "ready" : "required"}
                      key={element.id}
                    >
                      <span>
                        <strong>{element.label}</strong>
                        <small>{elementLimitLabel(element.minimum, element.maximum)}</small>
                      </span>
                      <b>{element.selected}</b>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>В текущем каталоге отдельные элементы этого Battlefleet не описаны.</p>
            )}
          </section>

          <section className="battlefleet-properties__section">
            <h4>Правила каталога</h4>
            {properties.rules.length ? (
              <div className="battlefleet-properties__rules">
                {properties.rules.map((rule) => (
                  <BattlefleetRule key={rule.id} rule={rule} />
                ))}
              </div>
            ) : (
              <p>Отдельный бонус Battlefleet в текущем каталоге не указан.</p>
            )}
          </section>

          <section className="battlefleet-properties__section battlefleet-properties__applied">
            <h4>Применено билдером</h4>
            <dl>
              <div>
                <dt>Обязательные элементы</dt>
                <dd>
                  {properties.completedRequiredElements} из {properties.requiredElements} заполнено
                </dd>
              </div>
              <div>
                <dt>Корабли</dt>
                <dd>{properties.shipCount}</dd>
              </div>
              <div>
                <dt>Закачка и стоимость</dt>
                <dd>Рассчитаны по каталогу</dd>
              </div>
            </dl>
            <p>
              Лимиты элементов, доступность вариантов и условные изменения стоимости учитываются
              автоматически при проверке состава.
            </p>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function BattlefleetRuleTitle({ rule }: { readonly rule: BattlefleetRuleReadModel }) {
  const localized = useRuleTranslation(rule.label);
  return localized.language === "ru" && localized.translation
    ? localized.translation.title
    : rule.label;
}

function BattlefleetRule({ rule }: { readonly rule: BattlefleetRuleReadModel }) {
  const localized = useRuleTranslation(rule.label);
  const translated = localized.language === "ru" ? localized.translation : null;
  const englishFallback =
    localized.language === "ru" && !localized.loading && !localized.translation;
  return (
    <article className="battlefleet-properties__rule">
      <header>
        <strong>{translated?.title ?? rule.label}</strong>
        {translated ? <small>{rule.label}</small> : null}
      </header>
      {englishFallback ? (
        <small className="battlefleet-properties__fallback">Оригинал EN</small>
      ) : null}
      <p>{translated?.text || rule.description || "Описание правила отсутствует в каталоге."}</p>
    </article>
  );
}

function elementLimitLabel(minimum: number, maximum: number | null): string {
  if (maximum === minimum) return `ровно ${minimum}`;
  if (maximum === null) return minimum ? `от ${minimum}` : "без верхнего лимита";
  if (!minimum) return `до ${maximum}`;
  return `${minimum}–${maximum}`;
}

function shipCountLabel(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  const noun =
    tens >= 11 && tens <= 14
      ? "кораблей"
      : ones === 1
        ? "корабль"
        : ones >= 2 && ones <= 4
          ? "корабля"
          : "кораблей";
  return `${count} ${noun}`;
}
