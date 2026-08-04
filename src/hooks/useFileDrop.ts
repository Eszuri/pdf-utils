import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useFileDrop(onDrop: (paths: string[]) => void, allowedExtensions?: string[]) {
  const [isHovering, setIsHovering] = useState(false);
  const extDeps = allowedExtensions?.join(",") || "";

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let isMounted = true;

    const setup = async () => {
      try {
        const win = getCurrentWindow();
        const unlisten = await win.onDragDropEvent((event) => {
          if (event.payload.type === "over" || event.payload.type === "enter") {
            setIsHovering(true);
          } else if (event.payload.type === "leave") {
            setIsHovering(false);
          } else if (event.payload.type === "drop") {
            setIsHovering(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              if (allowedExtensions && allowedExtensions.length > 0) {
                const filtered = paths.filter(p => {
                  const ext = p.split('.').pop()?.toLowerCase() || '';
                  return allowedExtensions.includes(ext);
                });
                if (filtered.length > 0) {
                  onDrop(filtered);
                }
              } else {
                onDrop(paths);
              }
            }
          }
        });

        if (!isMounted) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch (err) {
        console.error("Failed to setup drag drop event", err);
      }
    };

    setup();

    return () => {
      isMounted = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [onDrop, extDeps]); // Menggunakan string dependency agar tidak rerender saat array baru dipassing

  return { isHovering };
}

