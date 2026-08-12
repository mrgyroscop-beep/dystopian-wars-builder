export const BATTLE_SHIP_COUNTERS_STORAGE_KEY = "dwb.battle.ship-counters.v1";
export const BATTLE_DISPLAY_PREFERENCES_CHANGED_EVENT = "dwb:battle-display-preferences-changed";

export function readBattleShipCountersVisible(): boolean {
  return window.localStorage.getItem(BATTLE_SHIP_COUNTERS_STORAGE_KEY) === "show";
}

export function setBattleShipCountersVisible(visible: boolean): void {
  if (visible) window.localStorage.setItem(BATTLE_SHIP_COUNTERS_STORAGE_KEY, "show");
  else window.localStorage.removeItem(BATTLE_SHIP_COUNTERS_STORAGE_KEY);
  window.dispatchEvent(new Event(BATTLE_DISPLAY_PREFERENCES_CHANGED_EVENT));
}
