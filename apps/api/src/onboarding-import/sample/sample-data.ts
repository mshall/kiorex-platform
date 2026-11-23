/**
 * Deterministic synthetic "messy legacy clinic" dataset used by unit tests, the e2e suite and the manual UI demo
 * (npm run onboarding:sample). 100% fake: names/phones/ids are invented, NO real PHI.
 */
export interface SampleFile { name: string; bytes: Buffer }
const PDF = (tag: string) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${tag}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const PNG = (tag: string) => Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from(tag)]);
const JPG = (tag: string) => Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.from(tag), Buffer.from('ffd9', 'hex')]);
const mojibake = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

export function buildSample() {
  const sql = `-- Legacy "ClinicPro" dump (MySQL 5.7)  /* messy on purpose */
SET NAMES utf8;
DROP TABLE IF EXISTS \`tbl_patients\`;
CREATE TABLE \`tbl_patients\` (\`pat_id\` int(11) NOT NULL, \`pname\` varchar(120), \`mobile\` varchar(30), \`birth\` varchar(20), \`sex\` varchar(10), \`nat_no\` varchar(20), \`e_mail\` varchar(80), PRIMARY KEY (\`pat_id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8;
INSERT INTO \`tbl_patients\` VALUES
(1001,'أحمد محمد حسن','01012345678','1990-04-03','ذكر','29004031201234','ahmed@example.test'),
(1002,'منى عبد الله فهمي','٠١١٢٣٤٥٦٧٨٩','15/08/1985','أنثى','28508151301234',NULL),
(1003,'Hassan Ali Mostafa','01234567890','03/04/1990','M',NULL,NULL),
(1004,'Sara Ibrahim','012345','1992-02-30','F',NULL,'sara@example.test'),
(1005,'${mojibake('خالد عمر يوسف')}','01098765432','1978-11-20','ذكر','27811201401236',NULL),
(1006,'Nour El-Sayed','','2001-07-09','F',NULL,NULL),
(1007,'',  '01155556666','1999-01-01','M',NULL,NULL),
(1008,'أحمد محمد حسن','01012345678','1990-04-03','ذكر','29004031201234',NULL),
(1009,'ليلى كمال','01277778888','12/12/2012','أنثى',NULL,NULL),
(1010,'Omar Farouk O\\'Neil','+201066667777','1965-05-05','male',NULL,NULL),
(1011,'Youssef Adel','01233334444','1988-09-09','X',NULL,NULL),
(1012,'هدى سمير','01544445555','1995-03-03','أنثى','29503031501238',NULL),
(1013,'Karim Nabil','01022223333',NULL,'M',NULL,NULL),
(1014,'Dina Mahmoud','01566667777','1970-10-10','F',NULL,NULL),
(1015,'Tamer Sobhy','01088889999','1983-06-06','M',NULL,NULL);
CREATE TABLE appts (id int, pat_id int, app_date varchar(30), status varchar(20), dr varchar(50));
INSERT INTO appts (id, pat_id, app_date, status, dr) VALUES (1,1001,'2026-12-01 10:00','booked','Dr Ahmed'),(2,1002,'2026-12-02 11:30','booked','Dr Ahmed'),(3,999,'2026-12-03 09:00','booked','Dr Mona'),(4,1003,'not a date','booked','Dr Mona'),(5,1008,'2026-12-04 12:00','booked','Dr Ahmed');
CREATE TABLE exam (exam_id int, pid int, exam_date varchar(20), complaint text, dx text);
INSERT INTO exam VALUES (1,1001,'2026-01-10','Headache','Migraine'),(2,1002,'2026-02-11','صداع','شقيقة'),(3,1010,'2026-03-12','Cough','URTI'),(4,1012,'2026-03-13','ألم','التهاب');
CREATE TABLE inv (inv_no int, pid int, inv_date varchar(20), total varchar(20), paid varchar(20));
INSERT INTO inv VALUES (1,1001,'2026-01-10','350.00','350.00'),(2,1002,'2026-02-11','1,200.50','600'),(3,1010,'2026-03-12','abc','0');
CREATE TABLE cities (id int, nm varchar(40));
INSERT INTO cities VALUES (1,'Cairo'),(2,'Giza');
DROP TABLE IF EXISTS secret_users;
GRANT ALL ON *.* TO 'x'@'%';
`;
  const files: SampleFile[] = [
    { name: 'P1001_xray_chest.pdf', bytes: PDF('a1') }, { name: 'P1001_lab_cbc.pdf', bytes: PDF('a2') },
    { name: '29004031201234_idcard.jpg', bytes: JPG('a3') },
    { name: '01012345678_prescription.pdf', bytes: PDF('a4') },
    { name: 'Mona Abdullah Fahmy report.png', bytes: PNG('a5') },
    { name: 'P1003_mri.pdf', bytes: PDF('a6') }, { name: 'P1003_consent.pdf', bytes: PDF('a7') },
    { name: 'P1004_scan.png', bytes: PNG('a8') },
    { name: 'P1010_ecg.jpg', bytes: JPG('a9') }, { name: 'Omar Farouk ONeil referral.pdf', bytes: PDF('b1') },
    { name: '28508151301234_labs.pdf', bytes: PDF('b2') },
    { name: 'P1012_ultrasound.jpg', bytes: JPG('b3') }, { name: '01544445555_photo.png', bytes: PNG('b4') },
    { name: 'P1014_discharge.pdf', bytes: PDF('b5') }, { name: 'P1015_xray.pdf', bytes: PDF('b6') },
    { name: 'IMG_0001.jpg', bytes: JPG('b7') }, { name: 'scan_unknown.pdf', bytes: PDF('b8') },
    { name: 'P1009_note.pdf', bytes: PDF('b9') },
    { name: 'P1013_labs.pdf', bytes: PDF('c1') }, { name: 'P1011_vaccines.png', bytes: PNG('c2') },
  ];
  const extras = {
    malware: { name: 'invoice_scan.pdf', bytes: Buffer.concat([PDF('m'), Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]) } as SampleFile,
    disguisedExe: { name: 'labresult.pdf', bytes: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 1)]) } as SampleFile,
    duplicateOfFirst: { name: 'copy_of_xray.pdf', bytes: PDF('a1') } as SampleFile,
  };
  return { sql: Buffer.from(sql, 'utf8'), files, extras };
}
