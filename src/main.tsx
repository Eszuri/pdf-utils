import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { SettingsProvider } from "./contexts/SettingsContext";
import { ToolStateProvider } from "./contexts/ToolStateContext";
import App from "./App";
import { WordProvider } from "./contexts/WordContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <ToolStateProvider>
        <BrowserRouter>
          <ToastProvider>
            <WordProvider><App /></WordProvider>
          </ToastProvider>
        </BrowserRouter>
      </ToolStateProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
