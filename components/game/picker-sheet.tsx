"use client";

/**
 * A modal sheet wrapping the selection panel.
 *
 * On mobile it slides up from the bottom and holds the full viewport height.
 * On desktop it sits as a centred dialog with a max width. Either way it takes
 * the picker OUT of the main flow so the pitch, bench and toolbar all fit
 * above the fold — which is the whole reason it exists.
 *
 * Backdrop click and Escape both close it. Focus is trapped via the underlying
 * <dialog> element, and body scroll is disabled while it is open so the page
 * behind cannot ghost-scroll under the sheet.
 */

import { useEffect, useRef } from "react";

export function PickerSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => {
        // Native <dialog> receives clicks on the backdrop as clicks on itself
        // (its ::backdrop pseudo-element does not stop propagation). If the
        // click landed on the dialog element rather than its content, that's
        // the backdrop.
        if (e.target === dialog.current) onClose();
      }}
      className="m-0 w-full max-w-[560px] rounded-t-[22px] bg-white p-0 backdrop:bg-black/40 sm:m-auto sm:my-8 sm:rounded-[22px]"
      style={{
        maxHeight: "88vh",
        marginTop: "auto",
        marginBottom: "0",
      }}
    >
      <div className="flex items-center justify-between border-b border-[#eef2f6] px-4 py-3">
        <h2 className="text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef2f6] text-[16px] font-bold text-[var(--slate)]"
        >
          ×
        </button>
      </div>
      <div
        className="overflow-y-auto px-4 pb-6 pt-2"
        style={{ maxHeight: "calc(88vh - 60px)" }}
      >
        {children}
      </div>
    </dialog>
  );
}
