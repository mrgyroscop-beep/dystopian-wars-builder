import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createRoster,
  CreateRosterValidationError,
  validateCreateRosterInput,
  type CreateRosterDependencies,
  type CreateRosterErrors,
  type CreateRosterInput,
  type RosterSetupCatalog,
} from "../application/rosters/create-roster";
import { useDocumentTitle } from "../app/useDocumentTitle";

type SetupState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly catalog: RosterSetupCatalog }
  | { readonly kind: "error" };

const initialInput: CreateRosterInput = {
  name: "",
  factionId: "",
  battlefleetId: "",
  pointsLimit: "1000",
  victoryPointsLimit: "10",
};

export function NewRosterRoute(dependencies: CreateRosterDependencies) {
  useDocumentTitle("Создание флота");
  const navigate = useNavigate();
  const formId = useId();
  const [setup, setSetup] = useState<SetupState>({ kind: "loading" });
  const [input, setInput] = useState<CreateRosterInput>(initialInput);
  const [errors, setErrors] = useState<CreateRosterErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let active = true;
    dependencies.setupGateway.load().then(
      (catalog) => active && setSetup({ kind: "ready", catalog }),
      () => active && setSetup({ kind: "error" }),
    );
    return () => {
      active = false;
    };
  }, [dependencies.setupGateway]);

  if (setup.kind === "loading") {
    return (
      <RouteState title="Готовим каталог" description="Читаем доступные фракции и Battlefleet…" />
    );
  }

  if (setup.kind === "error") {
    return (
      <RouteState
        title="Каталог недоступен"
        description="Создание не начато, локальные флоты не изменены. Попробуйте открыть экран ещё раз."
        error
      />
    );
  }

  const catalog = setup.catalog;
  const faction = catalog.factions.find((candidate) => candidate.id === input.factionId);
  const battlefleet = faction?.battlefleets.find(
    (candidate) => candidate.id === input.battlefleetId,
  );

  function update<Field extends keyof CreateRosterInput>(
    field: Field,
    value: CreateRosterInput[Field],
  ) {
    setInput((current) => ({
      ...current,
      [field]: value,
      ...(field === "factionId" ? { battlefleetId: "" } : {}),
    }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCreateRosterInput(input, catalog);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSaveError(false);
    try {
      const roster = await createRoster(input, dependencies);
      await navigate(`/rosters/${roster.id}`);
    } catch (error) {
      if (error instanceof CreateRosterValidationError) setErrors(error.fields);
      else setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section-stack roster-creation">
      <div className="page-header roster-creation__header">
        <p className="eyebrow">Новая оперативная группа</p>
        <h1>Заложить основу флота</h1>
        <p className="page-lead">
          Пять решений на одном экране. После сохранения откроется пустой состав с обязательными
          элементами выбранного Battlefleet.
        </p>
      </div>

      {catalog.notice ? (
        <div className="catalog-notice" role="note">
          <span className="catalog-notice__mark" aria-hidden="true">
            D
          </span>
          <div>
            <strong>Режим демонстрации</strong>
            <p>{catalog.notice}</p>
          </div>
        </div>
      ) : null}

      <div className="creation-grid">
        <form
          className="panel creation-form"
          id={formId}
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div className="panel__header">
            <div>
              <p className="eyebrow">Параметры миссии</p>
              <h2>Новый список</h2>
            </div>
            <span className="badge">Локальное сохранение</span>
          </div>

          <div className="form-grid">
            <Field label="Название флота" error={errors.name} wide>
              <input
                aria-describedby={errors.name ? `${formId}-name-error` : undefined}
                aria-invalid={Boolean(errors.name)}
                autoComplete="off"
                maxLength={80}
                name="name"
                onChange={(event) => update("name", event.target.value)}
                placeholder="Например, Омская эскадра"
                value={input.name}
              />
              <FieldError id={`${formId}-name-error`} message={errors.name} />
            </Field>

            <Field label="Фракция" error={errors.factionId}>
              <select
                aria-describedby={errors.factionId ? `${formId}-faction-error` : undefined}
                aria-invalid={Boolean(errors.factionId)}
                name="factionId"
                onChange={(event) => update("factionId", event.target.value)}
                value={input.factionId}
              >
                <option value="">Выберите фракцию</option>
                {catalog.factions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <FieldError id={`${formId}-faction-error`} message={errors.factionId} />
            </Field>

            <Field label="Battlefleet" error={errors.battlefleetId}>
              <select
                aria-describedby={errors.battlefleetId ? `${formId}-battlefleet-error` : undefined}
                aria-invalid={Boolean(errors.battlefleetId)}
                disabled={!faction}
                name="battlefleetId"
                onChange={(event) => update("battlefleetId", event.target.value)}
                value={input.battlefleetId}
              >
                <option value="">
                  {faction ? "Выберите Battlefleet" : "Сначала выберите фракцию"}
                </option>
                {faction?.battlefleets.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <FieldError id={`${formId}-battlefleet-error`} message={errors.battlefleetId} />
            </Field>

            <Field label="Лимит Points" error={errors.pointsLimit}>
              <input
                aria-describedby={errors.pointsLimit ? `${formId}-points-error` : undefined}
                aria-invalid={Boolean(errors.pointsLimit)}
                inputMode="numeric"
                min="1"
                name="pointsLimit"
                onChange={(event) => update("pointsLimit", event.target.value)}
                step="1"
                type="number"
                value={input.pointsLimit}
              />
              <FieldError id={`${formId}-points-error`} message={errors.pointsLimit} />
            </Field>

            <Field label="Лимит VP" error={errors.victoryPointsLimit}>
              <input
                aria-describedby={errors.victoryPointsLimit ? `${formId}-vp-error` : undefined}
                aria-invalid={Boolean(errors.victoryPointsLimit)}
                inputMode="numeric"
                min="0"
                name="victoryPointsLimit"
                onChange={(event) => update("victoryPointsLimit", event.target.value)}
                step="1"
                type="number"
                value={input.victoryPointsLimit}
              />
              <FieldError id={`${formId}-vp-error`} message={errors.victoryPointsLimit} />
            </Field>
          </div>

          {saveError ? (
            <p className="form-submit-error" role="alert">
              Не удалось сохранить список на этом устройстве. Проверьте доступ к локальному
              хранилищу.
            </p>
          ) : null}

          <div className="creation-form__footer">
            <Link className="button button--secondary" to="/">
              Отмена
            </Link>
            <button className="button" disabled={saving} type="submit">
              {saving ? "Сохраняем…" : "Создать и открыть состав"}
            </button>
          </div>
        </form>

        <aside className="panel battlefleet-brief" aria-live="polite" aria-labelledby="brief-title">
          <div className="battlefleet-brief__radar" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">Боевой брифинг</p>
          <h2 id="brief-title">{battlefleet?.label ?? "Выберите Battlefleet"}</h2>
          <p className="battlefleet-brief__summary">
            {battlefleet?.summary ??
              "Здесь появятся особенности и обязательный каркас будущего состава."}
          </p>

          <div className="brief-limits" aria-label="Выбранные лимиты">
            <span>
              <strong>{input.pointsLimit || "—"}</strong> Points
            </span>
            <span>
              <strong>{input.victoryPointsLimit || "—"}</strong> VP
            </span>
          </div>

          <div className="required-elements">
            <h3>Обязательные элементы</h3>
            {battlefleet?.requiredElements.length ? (
              <ul>
                {battlefleet.requiredElements.map((element) => (
                  <li key={element.id}>
                    <span>{element.label}</span>
                    <strong>×{element.minimum}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Будут показаны после выбора Battlefleet.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({
  children,
  error,
  label,
  wide = false,
}: {
  readonly children: ReactNode;
  readonly error: string | undefined;
  readonly label: string;
  readonly wide?: boolean | undefined;
}) {
  return (
    <label
      className={`form-field${wide ? " form-field--wide" : ""}${error ? " form-field--error" : ""}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function FieldError({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string | undefined;
}) {
  return message ? (
    <small className="field-error" id={id}>
      {message}
    </small>
  ) : null;
}

function RouteState({
  title,
  description,
  error = false,
}: {
  readonly title: string;
  readonly description: string;
  readonly error?: boolean;
}) {
  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Создание флота</p>
        <h1>{title}</h1>
        <p className="page-lead" role={error ? "alert" : "status"}>
          {description}
        </p>
      </div>
      <Link className="button button--secondary" to="/">
        К моим флотам
      </Link>
    </div>
  );
}
