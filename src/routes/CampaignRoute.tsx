import { useState, type MouseEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useDocumentTitle } from "../app/useDocumentTitle";
import type { RuleReadModel } from "../application/rosters/profile-rules";
import {
  campaignProfile,
  campaignProfileModel,
  campaignRules,
  campaignScenario,
  campaignScenarios,
  type CampaignFaction,
  type CampaignFleetUnit,
  type CampaignScenario,
  type CampaignTab,
} from "../campaign/campaignData";
import { campaignShipImage } from "../campaign/campaignShipImages";
import { ShipProfileDialog } from "../ui/ProfileDialog";
import { RuleDescription, RuleLinks } from "../ui/ShipCardProfile";

const tabs: readonly { readonly id: CampaignTab; readonly label: string }[] = [
  { id: "mission", label: "Миссия" },
  { id: "crown", label: "Флот Короны" },
  { id: "empire", label: "Флот Империи" },
];

export function CampaignRoute() {
  const params = useParams<{ scenarioId?: string; tab?: string }>();
  const scenario = campaignScenario(params.scenarioId);
  const tab = isCampaignTab(params.tab) ? params.tab : "mission";
  const [profileUnit, setProfileUnit] = useState<CampaignFleetUnit | null>(null);
  const profile = profileUnit ? campaignProfileModel(profileUnit) : null;
  useDocumentTitle(`Кампания · Акт ${scenario.act}`);

  return (
    <div className="campaign-page">
      <header className="campaign-hero">
        <div className="campaign-hero__copy">
          <p className="eyebrow">Кампанийные встречи</p>
          <h1>Dominion of the Dragon</h1>
          <p>Пять связанных сценариев с фиксированными флотами и отдельными профилями.</p>
        </div>
        <div className="campaign-hero__seal" aria-hidden="true">
          <span>V</span>
          <small>актов</small>
        </div>
      </header>

      <nav aria-label="Выбор акта кампании" className="campaign-act-picker">
        {campaignScenarios.map((candidate) => (
          <Link
            aria-current={candidate.id === scenario.id ? "step" : undefined}
            className={
              candidate.id === scenario.id ? "campaign-act campaign-act--active" : "campaign-act"
            }
            key={candidate.id}
            to={`/campaign/${candidate.id}/${tab}`}
          >
            <span>Акт {candidate.act}</span>
            <strong>{candidate.titleRu}</strong>
          </Link>
        ))}
      </nav>

      <section className="campaign-encounter" aria-labelledby="campaign-encounter-title">
        <header className="campaign-encounter__header">
          <div>
            <p>Campaign encounter · Act {scenario.act}</p>
            <h2 id="campaign-encounter-title">{scenario.title}</h2>
            <span>{scenario.titleRu}</span>
          </div>
          <dl>
            <div>
              <dt>Поле</dt>
              <dd>{scenario.battlefield}</dd>
            </div>
            <div>
              <dt>Раунды</dt>
              <dd>{scenario.rounds}</dd>
            </div>
            <div>
              <dt>Отряды</dt>
              <dd>
                {scenario.crown.length} : {scenario.empire.length}
              </dd>
            </div>
          </dl>
        </header>

        <nav aria-label="Разделы выбранного сценария" className="campaign-tabs">
          {tabs.map((candidate) => (
            <Link
              aria-current={candidate.id === tab ? "page" : undefined}
              className={
                candidate.id === tab ? "campaign-tab campaign-tab--active" : "campaign-tab"
              }
              key={candidate.id}
              to={`/campaign/${scenario.id}/${candidate.id}`}
            >
              {candidate.label}
            </Link>
          ))}
        </nav>

        {tab === "mission" ? (
          <MissionPanel scenario={scenario} />
        ) : (
          <FleetPanel
            faction={tab === "crown" ? "Crown" : "Empire"}
            onOpenProfile={setProfileUnit}
            units={tab === "crown" ? scenario.crown : scenario.empire}
          />
        )}
      </section>

      {profile && profileUnit ? (
        <ShipProfileDialog
          faction={profile.faction}
          model={profile.model}
          name={profile.model.name}
          onClose={() => setProfileUnit(null)}
        />
      ) : null}
    </div>
  );
}

function MissionPanel({ scenario }: { readonly scenario: CampaignScenario }) {
  return (
    <div className="campaign-mission">
      <section className="campaign-narrative">
        <p className="eyebrow">Обстановка</p>
        <p>{scenario.narrative}</p>
      </section>

      <div className="campaign-mission__grid">
        <BattleMap scenario={scenario} />
        <aside className="campaign-brief">
          <p className="eyebrow">В этом акте</p>
          <ul>
            {scenario.principles.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ul>
          <p className="campaign-initiative">{scenario.initiative}</p>
        </aside>
      </div>

      <section className="campaign-section">
        <header>
          <span>01</span>
          <h3>Подготовка</h3>
        </header>
        <ol>
          {scenario.setup.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      {scenario.specialRules.length ? (
        <section className="campaign-special-rules" aria-label="Особые правила сценария">
          {scenario.specialRules.map((rule) => (
            <article key={rule.title}>
              <h3>{rule.title}</h3>
              <p>{rule.text}</p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="campaign-objectives" aria-label="Условия победы">
        <article>
          <p>Основная цель</p>
          <h3>Победа в сценарии</h3>
          <span>{scenario.objective}</span>
        </article>
        <article>
          <p>Специальная цель</p>
          <h3>Дополнительные очки</h3>
          <span>{scenario.specialObjective}</span>
        </article>
      </section>
    </div>
  );
}

function BattleMap({ scenario }: { readonly scenario: CampaignScenario }) {
  return (
    <figure className="campaign-map">
      <img
        alt={`Схема расстановки для ${scenario.title}`}
        decoding="async"
        src={`/campaign/maps/act-${scenario.act}.png`}
      />
      <figcaption>
        <span>Схема поля</span>
        <strong>{scenario.battlefield}</strong>
        <small>Оригинальная схема расстановки из кампанийного буклета.</small>
      </figcaption>
    </figure>
  );
}

function FleetPanel({
  faction,
  onOpenProfile,
  units,
}: {
  readonly faction: CampaignFaction;
  readonly onOpenProfile: (unit: CampaignFleetUnit) => void;
  readonly units: readonly CampaignFleetUnit[];
}) {
  const modelCount = units.reduce((total, unit) => total + unit.models, 0);
  const escortCount = units.reduce((total, unit) => total + (unit.escorts ?? 0), 0);
  return (
    <div className="campaign-fleet" data-faction={faction.toLocaleLowerCase("en")}>
      <header className="campaign-fleet__header">
        <div>
          <p className="eyebrow">Фиксированный состав</p>
          <h3>{faction === "Crown" ? "Флот Короны" : "Флот Империи"}</h3>
        </div>
        <dl>
          <div>
            <dt>Отряды</dt>
            <dd>{units.length}</dd>
          </div>
          <div>
            <dt>Модели</dt>
            <dd>{modelCount}</dd>
          </div>
          <div>
            <dt>Эскорты</dt>
            <dd>{escortCount}</dd>
          </div>
        </dl>
      </header>

      <ol className="campaign-fleet-list">
        {units.map((unit, index) => (
          <FleetUnitCard
            key={`${unit.profileId}:${index}`}
            onOpen={() => onOpenProfile(unit)}
            unit={unit}
          />
        ))}
      </ol>
    </div>
  );
}

function FleetUnitCard({
  onOpen,
  unit,
}: {
  readonly onOpen: () => void;
  readonly unit: CampaignFleetUnit;
}) {
  const profile = campaignProfile(unit.profileId);
  const shipImage = campaignShipImage(unit.profileId);
  const traits = [...profile.properties, ...profile.systems].join(", ");
  return (
    <li className={`campaign-unit-card${shipImage ? " campaign-unit-card--with-ship" : ""}`}>
      {shipImage ? (
        <div className="campaign-unit-card__ship">
          <img
            alt={`${profile.role} ${profile.name}`}
            decoding="async"
            loading="lazy"
            src={shipImage}
          />
        </div>
      ) : null}
      <div className="campaign-unit-card__body">
        <p>{profile.role}</p>
        <h4>{profile.name}</h4>
        <div className="campaign-unit-card__counts">
          <span>
            {unit.models} {plural(unit.models, "модель", "модели", "моделей")}
          </span>
          {unit.escorts ? (
            <span>
              {unit.escorts} {plural(unit.escorts, "эскорт", "эскорта", "эскортов")}
            </span>
          ) : null}
        </div>
        {traits ? (
          <CampaignTraits text={traits} />
        ) : (
          <span className="campaign-unit-card__empty">Без свойств и систем</span>
        )}
      </div>
      <button className="campaign-unit-card__open" onClick={onOpen} type="button">
        <span>Профиль</span>
        <b aria-hidden="true">→</b>
      </button>
    </li>
  );
}

function CampaignTraits({ text }: { readonly text: string }) {
  const [activeRule, setActiveRule] = useState<{
    readonly display: string;
    readonly kind: string;
    readonly rule: RuleReadModel;
    readonly trigger: HTMLButtonElement;
  } | null>(null);
  return (
    <div className="campaign-unit-card__traits">
      <RuleLinks
        kind="Кампанийное правило"
        onOpenRule={openRule}
        rules={campaignRules}
        text={text}
      />
      {activeRule ? (
        <RuleDescription
          display={activeRule.display}
          kind={activeRule.kind}
          onClose={() => setActiveRule(null)}
          rule={activeRule.rule}
          trigger={activeRule.trigger}
        />
      ) : null}
    </div>
  );

  function openRule(
    rule: RuleReadModel,
    display: string,
    kind: string,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    setActiveRule({ rule, display, kind, trigger: event.currentTarget });
  }
}

function isCampaignTab(value: string | undefined): value is CampaignTab {
  return tabs.some((tab) => tab.id === value);
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = value % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
