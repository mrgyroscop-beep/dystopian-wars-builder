import { useMemo, useState } from "react";

import { OrbatProfileDialog } from "./OrbatProfileDialog";
import {
  empireOrbatProfiles,
  orbatProfileCategories,
  type OrbatProfile,
  type OrbatProfileCategory,
} from "./orbatProfiles";

interface OrbatProfileBrowserProps {
  category: OrbatProfileCategory | "all";
  onAdd: (profile: OrbatProfile) => void;
  onCategoryChange: (category: OrbatProfileCategory | "all") => void;
}

function normalizeSearchTerm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ru");
}

export function OrbatProfileBrowser({
  category,
  onAdd,
  onCategoryChange,
}: OrbatProfileBrowserProps) {
  const [query, setQuery] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<OrbatProfile | null>(null);

  const filteredProfiles = useMemo(() => {
    const normalizedQuery = normalizeSearchTerm(query.trim());
    return empireOrbatProfiles.filter((profileEntry) => {
      const matchesCategory = category === "all" || profileEntry.category === category;
      const matchesQuery =
        !normalizedQuery || normalizeSearchTerm(profileEntry.name).includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  return (
    <>
      <div className="orbat-browser">
        <label className="orbat-browser__search">
          <span>Найти корабль</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Например, Akita"
            type="search"
            value={query}
          />
        </label>

        <label className="orbat-browser__search">
          <span>Категория</span>
          <select
            aria-label="Категория"
            onChange={(event) =>
              onCategoryChange(event.target.value as OrbatProfileCategory | "all")
            }
            value={category}
          >
            <option value="all">Все категории</option>
            {orbatProfileCategories.map((categoryEntry) => (
              <option key={categoryEntry} value={categoryEntry}>
                {categoryEntry}
              </option>
            ))}
          </select>
        </label>

        <p aria-live="polite" className="orbat-browser__count">
          Профилей: {filteredProfiles.length}
        </p>

        {filteredProfiles.length > 0 ? (
          <ul className="orbat-profile-list">
            {filteredProfiles.map((profileEntry) => (
              <li key={profileEntry.id}>
                <div className="orbat-profile-list__item">
                  <button
                    aria-label={`Открыть профиль ${profileEntry.name}`}
                    className="orbat-profile-list__button"
                    onClick={() => setSelectedProfile(profileEntry)}
                    type="button"
                  >
                    <span>{profileEntry.name}</span>
                    <small>
                      {profileEntry.category} · стр. {profileEntry.page}
                    </small>
                  </button>
                  <button
                    aria-label={`Добавить ${profileEntry.name} в состав`}
                    className="orbat-profile-list__add"
                    onClick={() => onAdd(profileEntry)}
                    title={`Добавить ${profileEntry.name} в состав`}
                    type="button"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="orbat-browser__empty">В Empire ORBAT такого названия не найдено.</p>
        )}
      </div>

      {selectedProfile ? (
        <OrbatProfileDialog profile={selectedProfile} onClose={() => setSelectedProfile(null)} />
      ) : null}
    </>
  );
}
