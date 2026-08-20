import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/shared/ui/attachment";

type WaveMessageAttachmentProps = {
  channelId?: string | null;
  fallbackText: string;
  huddleMemberPubkeys?: readonly string[];
  huddleMemberPubkeysPending?: boolean;
};

export function WaveMessageAttachment({
  fallbackText,
}: WaveMessageAttachmentProps) {
  return (
    <Attachment
      className="buzz-wave-hover-trigger mt-1 max-w-md"
      data-testid="message-wave-attachment"
      size="default"
    >
      <AttachmentMedia aria-hidden="true" className="text-lg">
        <span className="buzz-wave-hand">👋</span>
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{fallbackText}</AttachmentTitle>
      </AttachmentContent>
    </Attachment>
  );
}
