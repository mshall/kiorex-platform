import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFamily, useMe } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";

export interface PatientOption { id: string; name: string; relationship: "self" | string }
interface Ctx { patients: PatientOption[]; selectedId: string | null; selfId: string | null; dependantId: string | undefined; nameOf: (id: string) => string; setSelectedId: (id: string) => void; selected?: PatientOption; isLoading: boolean }
const PatientCtx = createContext<Ctx | null>(null);
const KEY = "kx-selected-patient";

/** Who is the visit for (family switcher). "self" is the account holder. */
export function PatientProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const signedIn = status === "signedIn";
  const me = useMe(signedIn);
  const family = useFamily(signedIn);
  const [selectedId, setSelected] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });

  const patients = useMemo<PatientOption[]>(() => {
    if (!me.data) return [];
    const self: PatientOption = { id: me.data.id, name: me.data.nameEn ?? me.data.nameAr ?? me.data.phone, relationship: "self" };
    return [self, ...(family.data ?? []).map((m) => ({ id: m.id, name: m.name, relationship: m.relationship }))];
  }, [me.data, family.data]);

  useEffect(() => {
    if (patients.length && !patients.some((p) => p.id === selectedId)) setSelected(patients[0].id);
  }, [patients, selectedId]);

  const value = useMemo<Ctx>(() => ({
    patients, selectedId, selected: patients.find((p) => p.id === selectedId), selfId: me.data?.id ?? null,
    dependantId: selectedId && selectedId !== me.data?.id ? selectedId : undefined,
    nameOf: (id: string) => (id === "self" ? patients[0]?.name : patients.find((p) => p.id === id)?.name) ?? "",
    isLoading: me.isLoading || family.isLoading,
    setSelectedId: (id) => { setSelected(id); try { localStorage.setItem(KEY, id); } catch { /* ignore */ } },
  }), [patients, selectedId, me.data?.id, me.isLoading, family.isLoading]);
  return <PatientCtx.Provider value={value}>{children}</PatientCtx.Provider>;
}

export function usePatient() {
  const c = useContext(PatientCtx);
  if (!c) throw new Error("usePatient outside PatientProvider");
  return c;
}
