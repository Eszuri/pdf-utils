import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { SettingsProvider } from "./contexts/SettingsContext";
import { ToolStateProvider } from "./contexts/ToolStateContext";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <ToolStateProvider>
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </ToolStateProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
