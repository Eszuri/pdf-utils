import { createContext, useContext, useCallback, useRef, useState, ReactNode } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useSettings } from "./SettingsContext";

export interface WordFile { path: string; name: string; pages: number }
export interface WordProgress { kind: "progress"; phase: "reading" | "converting" | "validating"; page: number; total: number }
export interface WordResult { pages: number; tables: number; images: number; characters: number; warnings: string[]; outputPath: string }
type Status = "idle" | "converting" | "cancelling" | "done" | "error" | "cancelled";
interface WordState {
  file: WordFile | null;
  setFile: (file: WordFile | null) => void;
  status: Status;
  progress: WordProgress | null;
  result: WordResult | null;
  error: string;
  convert: (output: string) => Promise<void>;
  cancel: () => Promise<void>;
}
const Context = createContext<WordState | null>(null);
export function useWord() {
  const state = useContext(Context);
  if (!state) throw new Error("WordProvider is required");
  return state;
}
export function WordProvider({ children }: { children: ReactNode }) {
  const { openExplorer } = useSettings();
  const [file, updateFile] = useState<WordFile | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<WordProgress | null>(null);
  const [result, setResult] = useState<WordResult | null>(null);
  const [error, setError] = useState("");
  const activeJob = useRef<string | null>(null);
  const setFile = useCallback((next: WordFile | null) => {
    if (activeJob.current) return;
    updateFile(next); setStatus("idle"); setResult(null); setProgress(null); setError("");
  }, []);
  async function convert(output: string) {
    if (!file || activeJob.current) return;
    const jobId = crypto.randomUUID();
    activeJob.current = jobId;
    setStatus("converting"); setResult(null); setProgress(null); setError("");
    const channel = new Channel<WordProgress>();
    channel.onmessage = (event) => {
      if (activeJob.current === jobId) setProgress(event);
    };
    try {
      const response = await invoke<WordResult>("convert_word", {
        request: { jobId, inputPath: file.path, outputPath: output }, progress: channel,
      });
      setResult(response); setStatus("done");
      if (openExplorer) invoke("show_in_folder", { path: response.outputPath }).catch(console.error);
    } catch (failure) {
      const message = String(failure);
      if (message === "CANCELLED") setStatus("cancelled");
      else { setError(message); setStatus("error"); }
    } finally { activeJob.current = null; }
  }
  async function cancel() {
    if (!activeJob.current) return;
    const jobId = activeJob.current;
    setStatus("cancelling");
    try { await invoke("cancel_word_conversion", { jobId }); }
    catch (failure) {
      if (activeJob.current === jobId) { setError(String(failure)); setStatus("converting"); }
    }
  }
  return <Context.Provider value={{ file, setFile, status, progress, result, error, convert, cancel }}>{children}</Context.Provider>;
}
