import { messageText, useMessengerCopy } from "@/shared/locale/messengerCopy";
export function ChannelScreenEmptyState() {
  useMessengerCopy();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
      <p className="text-sm text-muted-foreground">
        {messageText("Select a channel to view messages.")}{" "}
      </p>
    </div>
  );
}
