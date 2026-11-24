import type { Bilingual } from './site-data.types';

/** URL segment for a free-text place name ("Nasr City" -> nasr-city). ASCII, lowercase, 2..60 chars; null when nothing usable remains. */
export function slugifyPlace(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s.length >= 2 ? s : null;
}

/** Specialty code <-> URL segment (cardiology, internal-medicine). The code set is the closed list in safety/symptoms. */
export const specialtySegment = (code: string): string => code.replace(/_/g, '-');
export const specialtyFromSegment = (seg: string): string => seg.replace(/-/g, '_');

/** Arabic names for the Egyptian governorates seen in listing data; unknown places keep their source spelling in both languages. */
const GOVERNORATES_AR: Record<string, string> = {
  cairo: 'القاهرة', giza: 'الجيزة', alexandria: 'الإسكندرية', qalyubia: 'القليوبية', 'sharm-el-sheikh': 'شرم الشيخ', 'south-sinai': 'جنوب سيناء',
  dakahlia: 'الدقهلية', sharqia: 'الشرقية', gharbia: 'الغربية', monufia: 'المنوفية', beheira: 'البحيرة', suez: 'السويس', 'port-said': 'بورسعيد', ismailia: 'الإسماعيلية', luxor: 'الأقصر', aswan: 'أسوان',
};
const AREAS_AR: Record<string, string> = {
  'nasr-city': 'مدينة نصر', maadi: 'المعادي', heliopolis: 'مصر الجديدة', zamalek: 'الزمالك', dokki: 'الدقي', mohandessin: 'المهندسين', 'new-cairo': 'القاهرة الجديدة', 'sheikh-zayed': 'الشيخ زايد',
  '6th-of-october': 'السادس من أكتوبر', downtown: 'وسط البلد', shubra: 'شبرا', 'fifth-settlement': 'التجمع الخامس', agouza: 'العجوزة', 'rehab-city': 'مدينة الرحاب',
};

export function placeLabel(kind: 'city' | 'district', name: string): Bilingual {
  const seg = slugifyPlace(name) ?? '';
  const ar = (kind === 'city' ? GOVERNORATES_AR : AREAS_AR)[seg];
  return { en: name, ar: ar ?? name };
}
