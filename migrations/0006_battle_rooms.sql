PRAGMA foreign_keys = ON;

CREATE TABLE battle_rooms (
  id TEXT PRIMARY KEY,
  room_key TEXT NOT NULL UNIQUE,
  host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  host_roster_json TEXT NOT NULL,
  guest_roster_json TEXT,
  host_state_json TEXT NOT NULL DEFAULT '{}',
  guest_state_json TEXT NOT NULL DEFAULT '{}',
  host_ready INTEGER NOT NULL DEFAULT 0 CHECK (host_ready IN (0, 1)),
  guest_ready INTEGER NOT NULL DEFAULT 0 CHECK (guest_ready IN (0, 1)),
  round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number BETWEEN 1 AND 20),
  active_side TEXT NOT NULL DEFAULT 'host' CHECK (active_side IN ('host', 'guest')),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'preparing', 'active', 'finished')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX battle_rooms_host_idx ON battle_rooms(host_user_id, updated_at DESC);
CREATE INDEX battle_rooms_guest_idx ON battle_rooms(guest_user_id, updated_at DESC);
CREATE INDEX battle_rooms_expiry_idx ON battle_rooms(expires_at);
