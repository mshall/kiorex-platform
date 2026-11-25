"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTO_ACCEPT = exports.TARGET = exports.ENTITIES = void 0;
exports.classifyTable = classifyTable;
exports.proposeMapping = proposeMapping;
const normalize_1 = require("./normalize");
exports.ENTITIES = ['patients', 'appointments', 'visits', 'billing', 'documents'];
exports.TARGET = {
    patients: {
        tables: ['patients', 'patient', 'pat', 'clients', 'customers', 'مرضى', 'المرضى', 'patient_master', 'tblpatients', 'persons'],
        fields: [
            { key: 'sourceId', required: true, synonyms: ['id', 'patient_id', 'patientid', 'pid', 'pat_id', 'patid', 'pat_no', 'patient_no', 'file_no', 'mrn', 'code', 'رقم المريض', 'رقم الملف', 'كود'] },
            { key: 'fullName', synonyms: ['name', 'full_name', 'fullname', 'patient_name', 'الاسم', 'اسم المريض', 'الاسم الكامل'] },
            { key: 'firstName', synonyms: ['first_name', 'firstname', 'fname', 'given_name', 'الاسم الاول', 'الاسم الأول'] },
            { key: 'lastName', synonyms: ['last_name', 'lastname', 'lname', 'surname', 'family_name', 'اسم العائلة', 'اللقب'] },
            { key: 'phone', required: true, synonyms: ['phone', 'mobile', 'mobile_no', 'phone_number', 'tel', 'telephone', 'cell', 'whatsapp', 'الهاتف', 'رقم الهاتف', 'الموبايل', 'موبايل', 'تليفون', 'رقم الموبايل'] },
            { key: 'dob', synonyms: ['dob', 'birth_date', 'birthdate', 'date_of_birth', 'birthday', 'تاريخ الميلاد', 'الميلاد'] },
            { key: 'gender', synonyms: ['gender', 'sex', 'النوع', 'الجنس'] },
            { key: 'email', synonyms: ['email', 'e_mail', 'mail', 'البريد', 'البريد الالكتروني'] },
            { key: 'nationalId', synonyms: ['national_id', 'nationalid', 'nat_no', 'nat_id', 'natid', 'national_no', 'id_card', 'nid', 'ssn', 'id_number', 'id_no', 'الرقم القومي', 'رقم قومي', 'الرقم القومى'] },
        ],
    },
    appointments: {
        tables: ['appointments', 'appointment', 'bookings', 'reservations', 'visits_schedule', 'schedule', 'مواعيد', 'الحجوزات', 'tblappointments', 'appts', 'appt', 'apps'],
        fields: [
            { key: 'sourceId', required: true, synonyms: ['id', 'appointment_id', 'booking_id', 'app_id'] },
            { key: 'patientRef', required: true, synonyms: ['patient_id', 'patientid', 'pid', 'pat_id', 'patid', 'pat_no', 'patient', 'client_id', 'رقم المريض'] },
            { key: 'startsAt', required: true, synonyms: ['start', 'starts_at', 'start_time', 'appointment_date', 'date', 'datetime', 'scheduled_at', 'app_date', 'التاريخ', 'موعد'] },
            { key: 'status', synonyms: ['status', 'state', 'الحالة'] },
            { key: 'doctor', synonyms: ['doctor', 'doctor_name', 'doctor_id', 'provider', 'clinician', 'الطبيب', 'الدكتور'] },
            { key: 'notes', synonyms: ['notes', 'note', 'comment', 'reason', 'ملاحظات'] },
        ],
    },
    visits: {
        tables: ['visits', 'visit', 'encounters', 'consultations', 'examinations', 'medical_records', 'كشوفات', 'الزيارات', 'tblvisits', 'exam', 'exams'],
        fields: [
            { key: 'sourceId', required: true, synonyms: ['id', 'visit_id', 'encounter_id', 'exam_id'] },
            { key: 'patientRef', required: true, synonyms: ['patient_id', 'patientid', 'pid', 'pat_id', 'patid', 'pat_no', 'patient', 'رقم المريض'] },
            { key: 'visitedAt', required: true, synonyms: ['visit_date', 'date', 'visited_at', 'encounter_date', 'exam_date', 'تاريخ الكشف', 'التاريخ'] },
            { key: 'chiefComplaint', synonyms: ['complaint', 'chief_complaint', 'reason', 'الشكوى', 'سبب الزيارة'] },
            { key: 'diagnosis', synonyms: ['diagnosis', 'assessment', 'dx', 'التشخيص'] },
            { key: 'plan', synonyms: ['plan', 'treatment', 'prescription', 'rx', 'العلاج', 'الخطة'] },
            { key: 'doctor', synonyms: ['doctor', 'doctor_name', 'clinician', 'الطبيب'] },
        ],
    },
    billing: {
        tables: ['invoices', 'invoice', 'billing', 'payments', 'bills', 'receipts', 'فواتير', 'الفواتير', 'tblinvoices', 'inv', 'invs'],
        fields: [
            { key: 'sourceId', required: true, synonyms: ['id', 'invoice_id', 'invoice_no', 'inv_no', 'inv_id', 'bill_id', 'receipt_no'] },
            { key: 'patientRef', required: true, synonyms: ['patient_id', 'patientid', 'pid', 'pat_id', 'patid', 'pat_no', 'patient', 'رقم المريض'] },
            { key: 'issuedAt', required: true, synonyms: ['date', 'invoice_date', 'inv_date', 'issued_at', 'created_at', 'التاريخ'] },
            { key: 'amount', required: true, synonyms: ['amount', 'total', 'total_amount', 'grand_total', 'price', 'الاجمالي', 'المبلغ', 'الإجمالي'] },
            { key: 'paid', synonyms: ['paid', 'paid_amount', 'amount_paid', 'المدفوع'] },
            { key: 'currency', synonyms: ['currency', 'curr', 'العملة'] },
        ],
    },
    documents: {
        tables: ['documents', 'files', 'attachments', 'patient_files', 'scans', 'مستندات', 'ملفات', 'tbldocuments'],
        fields: [
            { key: 'sourceId', required: true, synonyms: ['id', 'file_id', 'doc_id', 'document_id'] },
            { key: 'patientRef', synonyms: ['patient_id', 'patientid', 'pid', 'pat_id', 'patid', 'pat_no', 'patient', 'رقم المريض'] },
            { key: 'fileName', required: true, synonyms: ['file_name', 'filename', 'path', 'file', 'file_path', 'اسم الملف'] },
            { key: 'description', synonyms: ['description', 'title', 'type', 'doc_type', 'الوصف'] },
        ],
    },
};
const norm = (s) => (0, normalize_1.nameKey)(s).replace(/[\s_\-.]+/g, '_');
function similarity(a, b) {
    if (a === b)
        return 1;
    if (a.replace(/_/g, '') === b.replace(/_/g, ''))
        return 0.97;
    if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))
        return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.9 + 0.1;
    const tri = (x) => { const s = new Set(); const p = `  ${x} `; for (let i = 0; i < p.length - 2; i++)
        s.add(p.slice(i, i + 3)); return s; };
    const A = tri(a);
    const B = tri(b);
    let inter = 0;
    for (const t of A)
        if (B.has(t))
            inter++;
    return inter / (A.size + B.size - inter);
}
function classifyTable(t) {
    const tn = norm(t.name).replace(/^(tbl|t|tb)_/, '');
    const cols = t.columns.map(norm);
    const ranked = exports.ENTITIES.map((entity) => {
        const def = exports.TARGET[entity];
        const nameScore = Math.max(...def.tables.map((x) => similarity(tn, norm(x))));
        let hit = 0;
        let req = 0;
        for (const f of def.fields) {
            const best = Math.max(0, ...cols.map((c) => Math.max(...f.synonyms.map((s) => similarity(c, norm(s))))));
            if (best >= 0.85)
                hit++;
            if (f.required && best >= 0.85)
                req++;
        }
        const colScore = hit / def.fields.length;
        const reqBonus = req / def.fields.filter((f) => f.required).length;
        const byName = nameScore * 0.55 + colScore * 0.3 + reqBonus * 0.15;
        const byCols = nameScore < 0.3 ? colScore * 0.5 + reqBonus * 0.5 : 0;
        return { entity, score: Math.min(1, Math.max(byName, byCols)) };
    }).sort((a, b) => b.score - a.score);
    return { entity: ranked[0].score >= 0.4 && ranked[0].score - ranked[1].score >= 0.12 ? ranked[0].entity : null, score: ranked[0].score, ranked };
}
function proposeMapping(entity, t) {
    const fields = exports.TARGET[entity].fields;
    const score = (f, c) => Math.max(...f.synonyms.map((s) => similarity(norm(c), norm(s))));
    const pairs = fields.flatMap((f) => t.columns.map((c) => ({ f: f.key, column: c, confidence: score(f, c) }))).filter((p) => p.confidence >= 0.6).sort((x, y) => y.confidence - x.confidence);
    const usedF = new Set();
    const usedC = new Set();
    const pick = new Map();
    for (const p of pairs) {
        if (usedF.has(p.f) || usedC.has(p.column))
            continue;
        usedF.add(p.f);
        usedC.add(p.column);
        pick.set(p.f, { column: p.column, confidence: Math.round(p.confidence * 100) / 100 });
    }
    return fields.map((f) => {
        const cands = t.columns.map((c) => ({ column: c, confidence: Math.round(score(f, c) * 100) / 100 })).sort((a, b) => b.confidence - a.confidence).slice(0, 4);
        const p = pick.get(f.key);
        return { field: f.key, column: p?.column ?? null, confidence: p?.confidence ?? 0, candidates: cands };
    });
}
exports.AUTO_ACCEPT = 0.85;
//# sourceMappingURL=mapper.js.map