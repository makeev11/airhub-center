import { Link } from "@tanstack/react-router";
import { MessageCircleCheck } from "lucide-react";

import type { StaffFamilyDetail } from "@/features/booking/data/staffFamilyDetailService";
import { Button } from "@/shared/ui/button";

export function FamilyConversationLinks({
  conversations,
  representativeId,
  locale,
}: {
  conversations: StaffFamilyDetail["conversations"];
  representativeId: string;
  locale: string;
}) {
  const label = locale.startsWith("ru")
    ? "Открыть чат"
    : locale.startsWith("pt")
      ? "Abrir conversa"
      : locale.startsWith("tr")
        ? "Sohbeti aç"
        : "Open chat";
  return conversations
    .filter((chat) => chat.representativeId === representativeId)
    .map((chat) => (
      <Button asChild key={chat.channelId} size="sm" variant="outline">
        <Link to="/channels/$channelId" params={{ channelId: chat.channelId }}>
          <MessageCircleCheck className="mr-1 h-4 w-4" />
          {label} · {chat.provider === "telegram" ? "Telegram" : chat.provider}
        </Link>
      </Button>
    ));
}
