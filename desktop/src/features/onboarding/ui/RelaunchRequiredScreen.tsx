import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart AirHop to finish recovery"
      body="Your identity was updated. AirHop needs to restart so syncing and agents run under it."
    />
  );
}
