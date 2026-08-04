import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { translations, Language, TranslationKey } from "../locales";

interface SettingsContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
  t: (key: TranslationKey) => string;
}

const defaultContext: SettingsContextType = {
  language: "id",
  setLanguage: () => {},
  accentColor: "indigo",
  setAccentColor: () => {},
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

  useEffect(() => {
    localStorage.setItem("app_lang", language);
  }, [language]);

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
    <SettingsContext.Provider value={{ language, setLanguage, accentColor, setAccentColor, t }}>
      {children}
    </SettingsContext.Provider>
  );
}
