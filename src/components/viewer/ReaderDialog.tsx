import { useEffect, useRef, type ReactNode } from "react";
import Icon from "./ViewerIcon";

export default function ReaderDialog({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="reader-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="reader-dialog-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="viewer-icon-button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
