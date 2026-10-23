"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Notice = { ok: boolean; text: string } | null;

type ReviewState = {
  /** The editor has changes that aren't saved yet. Approving is blocked while this is true. */
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  /** Result of the last save. Lives here so it survives the editor remounting on a new version. */
  notice: Notice;
  setNotice: (notice: Notice) => void;
};

const Ctx = createContext<ReviewState | null>(null);

/** Wraps the editor and the approve panel so they can share the unsaved-changes flag. */
export function ReviewProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const value = useMemo(() => ({ dirty, setDirty, notice, setNotice }), [dirty, notice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReview(): ReviewState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReview must be used inside <ReviewProvider>");
  return v;
}
