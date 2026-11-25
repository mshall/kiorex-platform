"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retentionRows = retentionRows;
exports.visitsPerPatient = visitsPerPatient;
const kanon_1 = require("../analytics/kanon");
function retentionRows(cells) {
    const by = new Map();
    for (const c of cells) {
        const l = by.get(c.cohortMonth) ?? [];
        l.push(c);
        by.set(c.cohortMonth, l);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cohortMonth, list]) => {
        if (list.every((c) => c.suppressed))
            return { cohortMonth, patients: kanon_1.MASK, suppressed: true, cells: [] };
        const sorted = list.filter((c) => !c.suppressed).sort((a, b) => a.monthIndex - b.monthIndex);
        const patients = sorted[0]?.patients ?? 0;
        return { cohortMonth, patients, suppressed: false, cells: sorted.map((c) => { const r = (0, kanon_1.maskCount)(c.retainedPatients); return { monthIndex: c.monthIndex, retained: r, rate: r === kanon_1.MASK ? kanon_1.MASK : patients > 0 ? Math.round((c.retainedPatients / patients) * 1000) / 10 : null }; }) };
    });
}
function visitsPerPatient(cells, upToMonth) {
    const by = new Map();
    for (const c of cells)
        if (!c.suppressed) {
            const l = by.get(c.cohortMonth) ?? [];
            l.push(c);
            by.set(c.cohortMonth, l);
        }
    let patients = 0;
    let bookings = 0;
    for (const list of by.values()) {
        if (!list.some((c) => c.monthIndex === upToMonth))
            continue;
        patients += list[0].patients;
        bookings += list.filter((c) => c.monthIndex <= upToMonth).reduce((s, c) => s + c.completedBookings, 0);
    }
    return patients < 10 ? null : Math.round((bookings / patients) * 100) / 100;
}
//# sourceMappingURL=retention.js.map