import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFamily, useMe } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { prefs } from "@/lib/storage";

export interface PatientOption { id: string; name: string; relationship: "self" | string; dependantId?: string }
interface Ctx { patients: PatientOption[]; selectedId: string | null; setSelectedId: (id: string) => void; selected?: PatientOption; isLoading: boolean }
const PatientCtx = createContext<Ctx | null>(null);
const KEY = "kx-selected-patient";

/** Who is the visit for (family switcher). "self" is the account holder; dependants are sent as `dependantId`. */
export function PatientProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const signedIn = status === "signedIn";
  const me = useMe(signedIn);
  const family = useFamily(signedIn);
  const [selectedId, setSelected] = useState<string | null>(null);
  useEffect(() => { void prefs.get(KEY).then((v) => v && setSelected(v)); }, []);

  const patients = useMemo<PatientOption[]>(() => {
    if (!me.data) return [];
    const self: PatientOption = { id: me.data.id, name: me.data.nameEn ?? me.data.nameAr ?? me.data.phone ?? "—", relationship: "self" };
    return [self, ...(family.data ?? []).map((m) => ({ id: m.id, name: m.nameEn ?? m.nameAr ?? "—", relationship: m.relationship, dependantId: m.id }))];
  }, [me.data, family.data]);

  useEffect(() => { if (patients.length && !patients.some((p) => p.id === selectedId)) setSelected(patients[0].id); }, [patients, selectedId]);

  const value = useMemo<Ctx>(() => ({
    patients, selectedId, selected: patients.find((p) => p.id === selectedId), isLoading: me.isLoading || family.isLoading,
    setSelectedId: (id) => { setSelected(id); void prefs.set(KEY, id); },
  }), [patients, selectedId, me.isLoading, family.isLoading]);
  return <PatientCtx.Provider value={value}>{children}</PatientCtx.Provider>;
}

export function usePatient() {
  const c = useContext(PatientCtx);
  if (!c) throw new Error("usePatient outside PatientProvider");
  return c;
}
