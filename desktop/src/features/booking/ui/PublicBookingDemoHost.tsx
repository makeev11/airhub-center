import { ArrowRight, Sparkles, X } from "lucide-react";
import * as React from "react";

import { getPublicBookingMessages } from "@/features/booking/lib/publicBookingLocale";
import { PublicBookingFlow } from "@/features/booking/ui/PublicBookingFlow";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";

export function PublicBookingDemoHost() {
  const messages = getPublicBookingMessages("ru-RU");
  const [open, setOpen] = React.useState(false);

  return (
    <main
      className="relative min-h-dvh overflow-hidden bg-background text-foreground"
      data-testid="airhop-public-demo-host"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_36%),radial-gradient(circle_at_85%_70%,color-mix(in_oklab,var(--accent)_55%,transparent),transparent_42%)]"
      />
      <div className="relative mx-auto flex min-h-dvh max-w-6xl items-center px-5 py-12 sm:px-10">
        <section className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            {messages.demoHostEyebrow}
          </div>
          <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
            {messages.demoHostTitle}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            {messages.demoHostDescription}
          </p>

          <Dialog onOpenChange={setOpen} open={open}>
            <DialogTrigger asChild>
              <Button
                className="mt-8 h-11 rounded-xl px-6"
                data-testid="airhop-public-widget-launcher"
                size="lg"
              >
                {messages.demoHostButton}
                <ArrowRight />
              </Button>
            </DialogTrigger>
            <DialogContent
              aria-describedby="airhop-widget-description"
              className="h-[calc(100dvh-2rem)] max-w-5xl overflow-hidden rounded-3xl p-0 max-sm:h-[calc(100dvh-1rem)] max-sm:w-[calc(100vw-1rem)] max-sm:max-w-none max-sm:rounded-2xl"
              data-testid="airhop-public-widget"
              showCloseButton={false}
            >
              <DialogTitle className="sr-only">
                {messages.widgetTitle}
              </DialogTitle>
              <DialogDescription
                className="sr-only"
                id="airhop-widget-description"
              >
                {messages.widgetDescription}
              </DialogDescription>
              <DialogClose asChild>
                <Button
                  aria-label={messages.close}
                  className="absolute right-2 top-2 z-20 h-11 w-11 rounded-full bg-background/90 shadow-sm sm:right-3 sm:top-3"
                  data-testid="airhop-public-widget-close"
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <X />
                </Button>
              </DialogClose>
              <PublicBookingFlow
                initialContext={{
                  branchId: "akademicheskaya",
                }}
                mode="embedded"
              />
            </DialogContent>
          </Dialog>
        </section>
      </div>
    </main>
  );
}
