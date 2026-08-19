import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart Airhop to finish recovery"
      body="Your identity was updated. Airhop needs to restart so syncing and agents run under it."
    />
  );
}
