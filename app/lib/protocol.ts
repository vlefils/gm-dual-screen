import type { Scene } from "./model.ts";

export const CHANNEL_NAME = "ecran-du-mj-v1";
export const PROTOCOL_VERSION = 1;

export type ProtocolMessage =
  | { version: 1; type: "PLAYER_READY" }
  | { version: 1; type: "PING"; sentAt: number }
  | { version: 1; type: "PONG"; sentAt: number }
  | { version: 1; type: "STATE_SNAPSHOT"; scene: Scene | null }
  | { version: 1; type: "STATE_PATCH"; scene: Scene | null };

export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { version?: unknown; type?: unknown };
  if (candidate.version !== PROTOCOL_VERSION) return false;
  return [
    "PLAYER_READY",
    "PING",
    "PONG",
    "STATE_SNAPSHOT",
    "STATE_PATCH",
  ].includes(String(candidate.type));
}
