import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/booking/clients")({
  component: BookingClientsRouteComponent,
});

function BookingClientsRouteComponent() {
  return <Outlet />;
}
