export interface AuthUser {
  readonly id: string;
  readonly displayName: string;
}

export interface AuthGateway {
  readonly contractVersion: 1;
  session(signal?: AbortSignal): Promise<AuthUser | null>;
  register(displayName: string): Promise<AuthUser>;
  login(): Promise<AuthUser>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
}
