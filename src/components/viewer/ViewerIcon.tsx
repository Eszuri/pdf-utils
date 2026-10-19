import type { ReactNode } from "react";

export type IconName =
  | "back"
  | "open"
  | "pages"
  | "search"
  | "prev"
  | "next"
  | "minus"
  | "plus"
  | "rotate"
  | "expand"
  | "collapse"
  | "download"
  | "close"
  | "menu"
  | "file"
  | "print"
  | "save"
  | "bookmark"
  | "info"
  | "undo"
  | "redo"
  | "outline";

export default function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    print: (
      <>
        <path d="M6 9V3h12v6M6 17H3V9h18v8h-3" />
        <path d="M6 14h12v7H6zM17 12h1" />
      </>
    ),
    save: (
      <>
        <path d="M4 3h13l4 4v14H3V3Z" />
        <path d="M7 3v6h9V3M7 21v-8h10v8" />
      </>
    ),
    bookmark: <path d="M6 3h12v18l-6-4-6 4Z" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    undo: (
      <>
        <path d="M3 10h12a6 6 0 0 1 0 12M3 10l5-5m-5 5 5 5" />
      </>
    ),
    redo: (
      <>
        <path d="M21 10H9a6 6 0 0 0 0 12m12-12-5-5m5 5-5 5" />
      </>
    ),
    outline: <path d="M4 5h2m3 0h11M4 12h2m3 0h11M4 19h2m3 0h11" />,
    back: <path d="m14 6-6 6 6 6M8 12h12" />,
    open: (
      <>
        <path d="M3 8V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v2" />
        <path d="m3 10-1 9h18l2-9Z" />
      </>
    ),
    pages: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 3v18m4-12h3m-3 4h3" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    prev: <path d="m14 6-6 6 6 6" />,
    next: <path d="m10 6 6 6-6 6" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M5 12h14m-7-7v14" />,
    rotate: (
      <>
        <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />
        <path d="M12 8v5l3 2" />
      </>
    ),
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    collapse: <path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    file: (
      <>
        <path d="M14 2H5v20h14V7Z" />
        <path d="M14 2v6h5M8 13h8m-8 4h6" />
      </>
    ),
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
