// "Add to calendar" (KXMBK09). No calendar permission needed: a Google Calendar template link (opened via Linking)
// plus a minimal iCalendar body. Contains only doctor/clinic/time — never clinical content.
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

export interface CalEvent { id: string; title: string; location: string; startsAt: string; endsAt: string }

export function buildIcs(e: CalEvent) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kiorex//Booking//EN", "BEGIN:VEVENT",
    `UID:${e.id}@kiorex.com`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(e.startsAt)}`, `DTEND:${stamp(e.endsAt)}`,
    `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.location)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

export const googleCalendarUrl = (e: CalEvent) =>
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${stamp(e.startsAt)}/${stamp(e.endsAt)}&location=${encodeURIComponent(e.location)}`;

export const directionsUrl = (c: { lat: number | null; lng: number | null; nameEn: string; addressEn: string }) =>
  c.lat != null && c.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.nameEn} ${c.addressEn}`)}`;

export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
