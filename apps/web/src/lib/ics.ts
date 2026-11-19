const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

/** Minimal iCalendar event (KXMBK09). Contains only doctor/clinic/time — no clinical content. */
export function buildIcs(e: { id: string; title: string; location: string; startsAt: string; endsAt: string }) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kiorex//Booking//EN", "BEGIN:VEVENT",
    `UID:${e.id}@kiorex.com`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(e.startsAt)}`, `DTEND:${stamp(e.endsAt)}`,
    `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.location)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

export function downloadIcs(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
