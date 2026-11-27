"use client";

import { PhoneIncoming } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, person, personFromAddress } from "@/lib/api";
import { ringOnce, unlockAudio } from "@/lib/ring";
import type { Session, User } from "@/lib/types";
import { Button, Dialog } from "./ui";

interface App {
  me: User;
  socket: Socket;
  online: boolean;
  queue: Session[];
  available: boolean;
  setAvailable: (on: boolean) => void;
  accept: (session: Session) => Promise<boolean>;
  toast: (text: string) => void;
  notice: string;
}

const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp must be used inside AppProvider");
  return app;
}

export const isExpert = (u: User) => u.role === "expert" || u.role === "admin";

const AVAILABLE_KEY = "arguide.available";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [online, setOnline] = useState(false);
  const [queue, setQueue] = useState<Session[]>([]);
  const [available, setAvailableState] = useState(true);
  const availableRef = useRef(true);
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState("");

  useEffect(() => {
    personFromAddress();
    api<User>("/auth/me").then(setMe, () => {}); // nobody chosen: api() sends the browser to /login
  }, []);

  useEffect(() => {
    if (!me) return;
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || undefined, {
      auth: { user: person() },
    });
    s.on("connect", () => setOnline(true));
    s.on("disconnect", () => setOnline(false));
    s.on("queue:update", (q: Session[]) => setQueue(q));
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [me]);

  // Experts: say whether calls should ring here, now and after every reconnect.
  useEffect(() => {
    if (!socket || !me || !isExpert(me)) return;
    try {
      availableRef.current = localStorage.getItem(AVAILABLE_KEY) !== "false";
    } catch {}
    setAvailableState(availableRef.current);
    const tell = () => socket.emit("expert:available", { on: availableRef.current });
    socket.on("connect", tell);
    if (socket.connected) tell();
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => {
      socket.off("connect", tell);
      window.removeEventListener("pointerdown", unlockAudio);
    };
  }, [socket, me]);

  const toast = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const setAvailable = useCallback((on: boolean) => {
    unlockAudio();
    availableRef.current = on;
    setAvailableState(on);
    try {
      localStorage.setItem(AVAILABLE_KEY, String(on));
    } catch {}
    socket?.emit("expert:available", { on });
    if (!on) setQueue([]);
  }, [socket]);

  const accept = useCallback(async (session: Session) => {
    if (!socket) return false;
    try {
      const r = await socket.timeout(8000).emitWithAck("call:accept", { sessionId: session.id });
      if (r.ok) {
        router.push(`/expert/session/${session.id}`);
        return true;
      }
      toast(r.error);
    } catch {
      toast("No reply from the server. Check your connection and try again.");
    }
    setDismissed((d) => new Set(d).add(session.id));
    return false;
  }, [socket, router, toast]);

  const inCall = pathname.startsWith("/expert/session/");
  const technicianCall = pathname.startsWith("/tech/session/");
  const incoming = me && isExpert(me) && available && !inCall ? queue.find((s) => !dismissed.has(s.id)) : undefined;

  useEffect(() => {
    if (!incoming) return;
    unlockAudio();
    ringOnce();
    const t = setInterval(ringOnce, 2500);
    return () => clearInterval(t);
  }, [incoming?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me || !socket) {
    return <p className="p-8 text-ink-soft" role="status">Loading ArGuide…</p>;
  }

  return (
    <AppContext.Provider value={{ me, socket, online, queue, available, setAvailable, accept, toast, notice }}>
      {children}

      <Dialog open={!!incoming} onClose={() => incoming && setDismissed((d) => new Set(d).add(incoming.id))} label="Incoming call">
        {incoming && (
          <div className="flex flex-col items-center text-center">
            <span className="mb-5 grid size-16 place-items-center rounded-full bg-blue text-white motion-safe:animate-ring">
              <PhoneIncoming aria-hidden className="size-7" />
            </span>
            <p className="text-sm text-dim">Incoming call</p>
            <p className="mt-1 text-2xl font-bold">{incoming.technician.name}</p>
            <p className="mt-2 text-dim">
              {[incoming.aircraft || "No aircraft given", incoming.checklist?.name].filter(Boolean).join(", ")}
            </p>
            <div className="mt-6 grid w-full grid-cols-2 gap-3">
              <Button size="lg" onClick={() => setDismissed((d) => new Set(d).add(incoming.id))}>
                Decline
              </Button>
              <Button size="lg" variant="go" autoFocus onClick={() => accept(incoming)}>
                Accept
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {!technicianCall && (
        <div role="status" className={`no-print pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 ${inCall ? "top-32 sm:top-24" : "bottom-24 sm:bottom-6 sm:justify-end"}`}>
          {notice && <p className="max-w-md rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-lg">{notice}</p>}
        </div>
      )}
    </AppContext.Provider>
  );
}
