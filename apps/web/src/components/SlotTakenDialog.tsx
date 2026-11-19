import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Slot } from "@/api/types";
import { SlotButton } from "./SlotButton";

/** 409 SLOT_TAKEN: show the (up to 3) alternatives Kiorly returned. */
export function SlotTakenDialog({ alternatives, onPick, onClose }: { alternatives: Slot[] | null; onPick: (s: Slot) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={alternatives !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="slot-taken-dialog">
        <DialogHeader>
          <DialogTitle>{t("booking.slotTakenTitle")}</DialogTitle>
          <DialogDescription>{alternatives && alternatives.length ? t("booking.slotTakenBody") : t("booking.slotTakenNone")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {(alternatives ?? []).map((s) => <SlotButton key={s.slotId} slot={s} onPick={onPick} />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
