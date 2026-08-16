"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Viewer = NonNullable<typeof api.users.viewer._returnType>;

type StudioContextValue = {
  viewer: Viewer | null | undefined;
  studioId: Id<"studios"> | null;
  setStudioId: (id: Id<"studios">) => void;
  role: string | null;
};

const StudioContext = createContext<StudioContextValue>({
  viewer: undefined,
  studioId: null,
  setStudioId: () => {},
  role: null,
});

const STORAGE_KEY = "slate.activeStudioId";

export function StudioProvider({ children }: { children: ReactNode }) {
  const viewer = useQuery(api.users.viewer);
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    setStored(localStorage.getItem(STORAGE_KEY));
  }, []);

  const studioId = useMemo(() => {
    if (!viewer || viewer.studios.length === 0) return null;
    const match = viewer.studios.find((s) => s._id === stored);
    return (match ?? viewer.studios[0])._id;
  }, [viewer, stored]);

  const setStudioId = (id: Id<"studios">) => {
    localStorage.setItem(STORAGE_KEY, id);
    setStored(id);
  };

  const role = useMemo(() => {
    if (!viewer || !studioId) return null;
    return (
      viewer.memberships.find((m) => m.studioId === studioId)?.role ?? null
    );
  }, [viewer, studioId]);

  return (
    <StudioContext.Provider value={{ viewer, studioId, setStudioId, role }}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  return useContext(StudioContext);
}
