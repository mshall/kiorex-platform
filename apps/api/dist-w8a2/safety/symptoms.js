"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPECIALTY_LABELS = exports.SPECIALTY_CODES = void 0;
exports.isSpecialtyCode = isSpecialtyCode;
exports.mapSymptomToSpecialties = mapSymptomToSpecialties;
const text_1 = require("./text");
exports.SPECIALTY_CODES = ['dermatology', 'paediatrics', 'obgyn', 'orthopaedics', 'ent', 'internal_medicine', 'cardiology', 'psychiatry', 'ophthalmology', 'urology', 'dentistry', 'allergy_immunology', 'anesthesiology', 'audiology', 'cardiothoracic_surgery', 'diabetes_endocrinology', 'emergency_medicine', 'family_medicine', 'gastroenterology', 'general_surgery', 'geriatrics', 'haematology', 'infectious_diseases', 'nephrology', 'neurology', 'neurosurgery', 'nutrition', 'oncology', 'pain_management', 'physiotherapy', 'plastic_surgery', 'pulmonology', 'radiology', 'rheumatology', 'sports_medicine', 'vascular_surgery'];
exports.SPECIALTY_LABELS = {
    dermatology: { en: 'Dermatology', ar: 'الجلدية' },
    paediatrics: { en: 'Paediatrics', ar: 'الأطفال' },
    obgyn: { en: 'Obstetrics & Gynaecology', ar: 'النساء والتوليد' },
    orthopaedics: { en: 'Orthopaedics', ar: 'العظام' },
    ent: { en: 'ENT', ar: 'الأنف والأذن والحنجرة' },
    internal_medicine: { en: 'Internal medicine', ar: 'الباطنة' },
    cardiology: { en: 'Cardiology', ar: 'القلب' },
    psychiatry: { en: 'Psychiatry', ar: 'الطب النفسي' },
    ophthalmology: { en: 'Ophthalmology', ar: 'العيون' },
    urology: { en: 'Urology', ar: 'المسالك البولية' },
    dentistry: { en: 'Dentistry', ar: 'الأسنان' },
    allergy_immunology: { en: 'Allergy & Immunology', ar: 'الحساسية والمناعة' },
    anesthesiology: { en: 'Anaesthesiology', ar: 'التخدير' },
    audiology: { en: 'Audiology & Speech', ar: 'السمعيات والتخاطب' },
    cardiothoracic_surgery: { en: 'Cardiothoracic Surgery', ar: 'جراحة القلب والصدر' },
    diabetes_endocrinology: { en: 'Diabetes & Endocrinology', ar: 'السكر والغدد الصماء' },
    emergency_medicine: { en: 'Emergency Medicine', ar: 'الطوارئ' },
    family_medicine: { en: 'Family Medicine', ar: 'طب الأسرة' },
    gastroenterology: { en: 'Gastroenterology', ar: 'الجهاز الهضمي والكبد' },
    general_surgery: { en: 'General Surgery', ar: 'الجراحة العامة' },
    geriatrics: { en: 'Geriatrics', ar: 'طب المسنين' },
    haematology: { en: 'Haematology', ar: 'أمراض الدم' },
    infectious_diseases: { en: 'Infectious Diseases', ar: 'الأمراض المعدية' },
    nephrology: { en: 'Nephrology', ar: 'أمراض الكلى' },
    neurology: { en: 'Neurology', ar: 'المخ والأعصاب' },
    neurosurgery: { en: 'Neurosurgery', ar: 'جراحة المخ والأعصاب' },
    nutrition: { en: 'Nutrition & Dietetics', ar: 'التغذية' },
    oncology: { en: 'Oncology', ar: 'الأورام' },
    pain_management: { en: 'Pain Management', ar: 'علاج الألم' },
    physiotherapy: { en: 'Physiotherapy', ar: 'العلاج الطبيعي' },
    plastic_surgery: { en: 'Plastic & Cosmetic Surgery', ar: 'جراحة التجميل' },
    pulmonology: { en: 'Pulmonology & Chest', ar: 'الصدر والجهاز التنفسي' },
    radiology: { en: 'Radiology', ar: 'الأشعة' },
    rheumatology: { en: 'Rheumatology', ar: 'الروماتيزم' },
    sports_medicine: { en: 'Sports Medicine', ar: 'الطب الرياضي' },
    vascular_surgery: { en: 'Vascular Surgery', ar: 'جراحة الأوعية الدموية' },
};
const MAP = {
    dermatology: ['rash', 'acne', 'eczema', 'skin', 'itch', 'hair loss', 'جلد', 'حبوب', 'طفح', 'حكه', 'تساقط الشعر', 'اكزيما'],
    paediatrics: ['child', 'baby', 'infant', 'toddler', 'kid fever', 'طفل', 'رضيع', 'اطفال', 'بيبي'],
    obgyn: ['pregnan', 'period', 'menstrua', 'gynae', 'gynec', 'حمل', 'دوره', 'نساء', 'ولاده', 'توليد'],
    orthopaedics: ['knee', 'back pain', 'bone', 'fracture', 'joint', 'shoulder', 'عظام', 'ركبه', 'ظهر', 'كسر', 'مفاصل', 'كتف'],
    ent: ['ear', 'throat', 'sinus', 'tonsil', 'nose', 'hearing', 'اذن', 'حلق', 'جيوب انفيه', 'لوز', 'انف', 'سمع'],
    internal_medicine: ['stomach', 'diabetes', 'blood pressure', 'fatigue', 'thyroid', 'معده', 'سكر', 'ضغط', 'تعب', 'غده', 'هضم'],
    cardiology: ['heart', 'palpitation', 'cardio', 'قلب', 'خفقان'],
    psychiatry: ['anxiety', 'depress', 'panic', 'insomnia', 'stress', 'قلق', 'اكتئاب', 'نفسي', 'ارق'],
    ophthalmology: ['eye', 'vision', 'blurry', 'cataract', 'عين', 'نظر', 'عيون', 'مياه بيضاء'],
    urology: ['urine', 'urinary', 'kidney stone', 'prostate', 'بول', 'مسالك', 'حصوات', 'بروستاتا'],
    dentistry: ['tooth', 'teeth', 'dental', 'gum', 'cavity', 'سن', 'اسنان', 'ضرس', 'لثه'],
    allergy_immunology: ['allergy', 'allergic', 'hives', 'asthma allergy', 'حساسيه', 'مناعه', 'ارتكاريا'],
    anesthesiology: ['anesthesia', 'anaesthesia', 'sedation', 'تخدير', 'بنج'],
    audiology: ['speech', 'stutter', 'hearing test', 'تخاطب', 'تاتاه', 'سمعيات'],
    cardiothoracic_surgery: ['open heart', 'bypass', 'chest surgery', 'جراحه قلب', 'جراحه صدر'],
    diabetes_endocrinology: ['insulin', 'hormone', 'endocrin', 'pcos', 'غدد صماء', 'هرمون', 'انسولين'],
    emergency_medicine: ['emergency', 'trauma', 'طوارئ', 'اسعاف'],
    family_medicine: ['family doctor', 'checkup', 'check up', 'طب اسره', 'كشف عام'],
    gastroenterology: ['gastro', 'reflux', 'ibs', 'bowel', 'liver', 'diarrhea', 'constipation', 'قولون', 'كبد', 'اسهال', 'امساك', 'ارتجاع'],
    general_surgery: ['hernia', 'appendix', 'gallbladder', 'surgery', 'فتق', 'زايده', 'مراره', 'جراحه'],
    geriatrics: ['elderly', 'dementia', 'مسن', 'شيخوخه', 'خرف'],
    haematology: ['anemia', 'anaemia', 'blood disorder', 'clotting', 'انيميا', 'فقر دم', 'امراض دم'],
    infectious_diseases: ['infection', 'hepatitis', 'hiv', 'malaria', 'عدوي', 'التهاب كبدي'],
    nephrology: ['kidney', 'dialysis', 'renal', 'كلي', 'غسيل كلوي', 'فشل كلوي'],
    neurology: ['headache', 'migraine', 'seizure', 'epilepsy', 'stroke', 'numbness', 'صداع', 'صرع', 'جلطه', 'تنميل', 'اعصاب', 'مخ'],
    neurosurgery: ['brain tumor', 'spine surgery', 'disc', 'جراحه مخ', 'ديسك', 'جراحه عمود فقري'],
    nutrition: ['diet', 'weight loss', 'obesity', 'nutrition', 'تغذيه', 'رجيم', 'سمنه', 'نحافه'],
    oncology: ['cancer', 'tumor', 'tumour', 'chemotherapy', 'سرطان', 'ورم', 'اورام', 'كيماوي'],
    pain_management: ['chronic pain', 'pain clinic', 'الم مزمن', 'علاج الم'],
    physiotherapy: ['physio', 'rehab', 'rehabilitation', 'physical therapy', 'علاج طبيعي', 'تاهيل'],
    plastic_surgery: ['cosmetic', 'plastic', 'rhinoplasty', 'burn scar', 'تجميل', 'جراحه تجميل', 'تجميلي'],
    pulmonology: ['cough', 'asthma', 'breath', 'lung', 'copd', 'shortness of breath', 'كحه', 'ربو', 'صدر', 'ضيق تنفس', 'رئه'],
    radiology: ['x-ray', 'xray', 'mri', 'ct scan', 'ultrasound', 'اشعه', 'رنين', 'سونار', 'مقطعيه'],
    rheumatology: ['rheumat', 'lupus', 'arthritis', 'gout', 'روماتيزم', 'نقرس', 'ذئبه', 'التهاب مفاصل'],
    sports_medicine: ['sports injury', 'athlete', 'sprain', 'اصابات ملاعب', 'رياضي', 'التواء'],
    vascular_surgery: ['varicose', 'vascular', 'دوالي', 'اوعيه دمويه'],
};
const NMAP = Object.entries(MAP).map(([c, l]) => [c, l.map(text_1.normalizeText)]);
function isSpecialtyCode(s) {
    return exports.SPECIALTY_CODES.includes(s);
}
function mapSymptomToSpecialties(text) {
    const n = (0, text_1.normalizeText)(text);
    const hits = [];
    for (const [code, list] of NMAP) {
        let score = 0;
        for (const kw of list)
            if (kw.length >= 2 && n.includes(kw))
                score += kw.length > 3 ? 2 : 1;
        const label = exports.SPECIALTY_LABELS[code];
        if (n.includes(code.replace('_', ' ')) || n.includes((0, text_1.normalizeText)(label.en)) || n.includes((0, text_1.normalizeText)(label.ar)))
            score += 3;
        if (score)
            hits.push([code, score]);
    }
    return hits.sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
//# sourceMappingURL=symptoms.js.map