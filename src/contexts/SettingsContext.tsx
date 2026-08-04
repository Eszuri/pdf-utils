import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { translations, Language, TranslationKey } from "../locales";

interface SettingsContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
  openExplorer: boolean;
  setOpenExplorer: (val: boolean) => void;
  pdfContextMenu: boolean;
  setPdfContextMenu: (val: boolean) => void;
  t: (key: TranslationKey) => string;
}

const defaultContext: SettingsContextType = {
  language: "id",
  setLanguage: () => {},
  accentColor: "indigo",
  setAccentColor: () => {},
  openExplorer: true,
  setOpenExplorer: () => {},
  pdfContextMenu: false,
  setPdfContextMenu: () => {},
  t: (key) => key,
};

const SettingsContext = createContext<SettingsContextType>(defaultContext);

export function useSettings() {
  return useContext(SettingsContext);
}

export const accentColors: Record<string, string> = {
  indigo: "#6366f1",
  blue: "#3b82f6",
  emerald: "#10b981",
  rose: "#f43f5e",
  amber: "#f59e0b",
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    return (localStorage.getItem("app_lang") as Language) || "id";
  });

  const [accentColor, setAccentColor] = useState<string>(() => {
    return localStorage.getItem("app_accent") || "indigo";
  });

  const [openExplorer, setOpenExplorer] = useState<boolean>(() => {
    const val = localStorage.getItem("app_open_explorer");
    return val !== null ? val === "true" : true;
  });

  const [pdfContextMenu, setPdfContextMenu] = useState<boolean>(() => {
    return localStorage.getItem("app_pdf_context_menu") === "true";
  });

  useEffect(() => {
    localStorage.setItem("app_lang", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("app_open_explorer", String(openExplorer));
  }, [openExplorer]);

  useEffect(() => {
    localStorage.setItem("app_pdf_context_menu", String(pdfContextMenu));
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("toggle_context_menu", { enable: pdfContextMenu }).catch(console.error);
    });
  }, [pdfContextMenu]);

  useEffect(() => {
    localStorage.setItem("app_accent", accentColor);
    
    const hex = accentColors[accentColor] || accentColors.indigo;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const root = document.documentElement;
    root.style.setProperty("--accent", hex);
    root.style.setProperty("--accent-hover", `rgba(${r}, ${g}, ${b}, 0.8)`);
    root.style.setProperty("--accent-muted", `rgba(${r}, ${g}, ${b}, 0.6)`);
    root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.12)`);
  }, [accentColor]);

  const t = (key: TranslationKey) => {
    return translations[language][key] || key;
  };

  return (
    <SettingsContext.Provider value={{ language, setLanguage, accentColor, setAccentColor, openExplorer, setOpenExplorer, pdfContextMenu, setPdfContextMenu, t }}>
      {children}
    </SettingsContext.Provider>
  );
}
