export const AUTH_SESSION_CHANGED_EVENT = "dwb:auth-session-changed";

export function announceAuthSessionChanged(): void {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}
