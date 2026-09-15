import React from "react";
import ReactDOM from "react-dom/client";
import { ChatDemo } from "./features/chat/demo/ChatDemo";
import "@fontsource-variable/inter/wght.css";
import "./shared/styles/globals.css";

// Only build:chat-demo can reach this entry. Never included in the Center bundle.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ChatDemo />
  </React.StrictMode>,
);
