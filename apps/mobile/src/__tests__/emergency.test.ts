import { EMERGENCY_NUMBER, isEmergencyQuery } from "@/lib/emergency";

describe("emergency keyword detection (KX-16 H07)", () => {
  it("uses 123", () => expect(EMERGENCY_NUMBER).toBe("123"));
  it.each(["chest pain", "I can't breathe", "severe bleeding", "heart attack", "overdose", "ambulance please", "ألم في الصدر", "لا أستطيع التنفس", "نزيف شديد", "جلطة", "إسعاف", "طوارئ"])("flags %s", (q) => expect(isEmergencyQuery(q)).toBe(true));
  it.each(["dentist", "cardiology", "أسنان", "طبيب أطفال", "dermatology Nasr City", ""])("does not flag %s", (q) => expect(isEmergencyQuery(q)).toBe(false));
  it("is case-insensitive and tolerant of spacing", () => expect(isEmergencyQuery("CHEST   PAIN")).toBe(true));
});
