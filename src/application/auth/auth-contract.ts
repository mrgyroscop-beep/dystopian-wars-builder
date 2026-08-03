export interface AuthUser {
  readonly id: string;
  readonly displayName: string;
}

export interface AuthGateway {
  readonly contractVersion: 1;
  session(signal?: AbortSignal): Promise<AuthUser | null>;
  register(email: string, password: string, displayName: string): Promise<AuthUser>;
  login(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
}
