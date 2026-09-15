import React from "react";
import ReactDOM from "react-dom/client";
import { ChatPage } from "./features/chat/ui/ChatPage";
import "@fontsource-variable/inter/wght.css";
import "./shared/styles/globals.css";

// A small, separate entry avoids shipping the repository browser to phones.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ChatPage />
  </React.StrictMode>,
);
