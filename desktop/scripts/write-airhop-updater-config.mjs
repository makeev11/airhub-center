import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { airhopUpdaterConfig } from "./airhop-updater-config.mjs";

const updater = airhopUpdaterConfig();
assert(updater, "Signed releases require AirHop updater settings");
assert(
  process.argv[2],
  "Specify an output config path outside the source checkout",
);
writeFileSync(
  process.argv[2],
  JSON.stringify(
    {
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater },
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
