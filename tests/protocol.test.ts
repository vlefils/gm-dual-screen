import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  isProtocolMessage,
} from "../app/lib/protocol.ts";

test("le protocole accepte les messages de synchronisation connus", () => {
  assert.equal(
    isProtocolMessage({
      version: PROTOCOL_VERSION,
      type: "STATE_SNAPSHOT",
      scene: null,
    }),
    true,
  );
  assert.equal(
    isProtocolMessage({ version: PROTOCOL_VERSION, type: "PLAYER_READY" }),
    true,
  );
});

test("le protocole rejette les versions ou événements inconnus", () => {
  assert.equal(isProtocolMessage({ version: 2, type: "PLAYER_READY" }), false);
  assert.equal(isProtocolMessage({ version: 1, type: "DELETE_ALL" }), false);
  assert.equal(isProtocolMessage(null), false);
});
