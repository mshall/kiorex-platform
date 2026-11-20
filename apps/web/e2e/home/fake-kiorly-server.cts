// Standalone fake Kiorly marketplace API for the home-visit E2E stack (the real Kiorly Clinic needs clinic-side gates and an org with home visits;
// this reuses the API's own HMAC-verifying fake, apps/api/test/fake-kiorly.ts). Prints its port to the state file, serves until killed.
import { writeFileSync } from "node:fs";
import { FakeKiorly } from "../../../api/test/fake-kiorly";

const slotAt = (dayOffset: number, hourUtc: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(hourUtc, 0, 0, 0); return { startsAt: d.toISOString(), endsAt: new Date(d.getTime() + 30 * 60_000).toISOString() }; };

async function main() {
  const k = await new FakeKiorly().start();
  k.slots = [slotAt(2, 8), slotAt(2, 9), slotAt(3, 8), slotAt(3, 9)];
  const doc = FakeKiorly.provider({ id: "lst_doc", clinicianId: "dr_doc", clinicId: "cl_doc", specialty: "family_medicine", nameEn: "Dr Hala Mansour", nameAr: "د. هالة منصور", typeId: "typ_doc", fee: 300 });
  const nurse = FakeKiorly.provider({ id: "lst_nurse", clinicianId: "dr_nurse", clinicId: "cl_nurse", profession: "NURSE", edition: "NURSE", serviceLocations: ["HOME"], coverageDistricts: ["maadi", "nasr-city"], assignsClinician: true, register: "NURSING_SYNDICATE", specialty: "nursing", nameEn: "Nile Home Nursing", nameAr: "النيل للتمريض المنزلي", typeId: "typ_home", feeServiceLocation: "HOME", fee: 200, homeSurcharge: 50 });
  const physio = FakeKiorly.provider({ id: "lst_physio", clinicianId: "dr_physio", clinicId: "cl_physio", profession: "PHYSIOTHERAPIST", serviceLocations: ["IN_CLINIC", "HOME"], coverageDistricts: ["maadi"], register: "PHYSIO_SYNDICATE", specialty: "physio_therapy", nameEn: "Dr Karim Fouad (physio)", nameAr: "د. كريم فؤاد (علاج طبيعي)", typeId: "typ_phys_clinic", feeServiceLocation: "IN_CLINIC", fee: 250 });
  (physio.provider.fees as unknown[]).push({ appointmentTypeId: "typ_phys_home", nameEn: "Home session", nameAr: "جلسة منزلية", amount: 250, currency: "EGP", serviceLocation: "HOME", homeSurcharge: 40 });
  k.providers = [doc, nurse, physio];
  writeFileSync(process.argv[2], String(k.port));
  process.stdout.write(`[fake-kiorly] :${k.port}\n`);
  setInterval(() => undefined, 1 << 30);
}
void main();
