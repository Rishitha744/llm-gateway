import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface Session {
  apiKey: string | null;
  adminToken: string | null;
  demo: boolean;
}

interface SessionCtx extends Session {
  update: (patch: Partial<Session>) => void;
  signOut: () => void;
}

const STORAGE_KEY = "gw.session";
const EMPTY: Session = { apiKey: null, adminToken: null, demo: false };

export const DEMO_ONLY = import.meta.env.VITE_DEMO_ONLY === "true";

function load(): Session {
  if (DEMO_ONLY) return { apiKey: "gw_demo", adminToken: "demo", demo: true };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

// Module-level mirror so the non-React API client can read credentials.
let current: Session = load();
export const getSession = () => current;

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(current);

  const persist = useCallback((next: Session) => {
    current = next;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: session lives in memory only */
    }
    setSession(next);
  }, []);

  const value = useMemo<SessionCtx>(
    () => ({
      ...session,
      update: (patch) => persist({ ...current, ...patch }),
      signOut: () => persist(DEMO_ONLY ? current : EMPTY),
    }),
    [session, persist],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
