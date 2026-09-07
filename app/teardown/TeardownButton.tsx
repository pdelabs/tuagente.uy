"use client";

// Reusable trigger for the workflow-teardown modal. Renders a button (styling
// and label come from the caller via className + children so it fits each place
// it's used — the hero and the pricing card), owns the open state, and returns
// focus to itself when the modal closes.

import { ReactNode, useRef, useState } from "react";
import TeardownModal from "./TeardownModal";

export default function TeardownButton({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && (
        <TeardownModal
          onClose={() => {
            setOpen(false);
            btnRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
