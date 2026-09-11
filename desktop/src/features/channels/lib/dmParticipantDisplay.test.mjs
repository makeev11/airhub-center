import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectMessageIntro,
  isSelfDirectMessage,
} from "./dmParticipantDisplay.ts";
import { resolveChannelDisplayLabel } from "../../sidebar/lib/channelLabels.ts";

const self = "a".repeat(64);
const peer = "b".repeat(64);
const profiles = {
  [self]: { displayName: "Andrey", avatarUrl: "data:image/png;base64,self" },
  [peer]: { displayName: "Alice", avatarUrl: "data:image/png;base64,alice" },
};
const channel = {
  channelType: "dm",
  name: "DM",
  participantPubkeys: [self.toUpperCase()],
  participants: ["Old name"],
};

test("self conversation uses the current profile photo and name in its intro and label", () => {
  const intro = buildDirectMessageIntro({
    channel,
    currentPubkey: self,
    profiles,
  });
  assert.equal(intro.isSelf, true);
  assert.match(intro.displayName, /^Andrey \(.+\)$/u);
  assert.equal(intro.participants[0].avatarUrl, profiles[self].avatarUrl);
  assert.equal(
    resolveChannelDisplayLabel({ ...channel, name: "You" }, self, profiles),
    intro.displayName,
  );
});

test("ordinary direct messages still show the other participant", () => {
  const intro = buildDirectMessageIntro({
    channel: {
      ...channel,
      participantPubkeys: [self, peer],
      participants: ["Andrey", "Alice"],
    },
    currentPubkey: self,
    profiles,
  });
  assert.equal(intro.isSelf, false);
  assert.equal(intro.displayName, "Alice");
  assert.equal(intro.participants.length, 1);
  assert.equal(intro.participants[0].avatarUrl, profiles[peer].avatarUrl);
});

test("empty, unidentified, and non-DM channels are not self conversations", () => {
  assert.equal(
    isSelfDirectMessage({ ...channel, participantPubkeys: [] }, self),
    false,
  );
  assert.equal(isSelfDirectMessage(channel), false);
  assert.equal(
    isSelfDirectMessage({ ...channel, channelType: "channel" }, self),
    false,
  );
});
