// Plain words -> Medicare billing codes, for the medical-prices tool.
// Every code below was checked against the live CMS files on 2026-10-14 (physician file: the HCPCS_Cd values; inpatient file: the DRG_Cd values;
// the tests list them again so a code CMS drops is noticed). Labels are ProofPrice's own plain words: CPT(R) code descriptions are copyright of the
// American Medical Association and are not copied from the CMS files (see INFO.licence in ./source.ts).
//
// "setting" in the Medicare physician file:
//   office    = a non-facility setting such as a doctor's office (Place_Of_Srvc "O"): the payment covers the whole service (doctor + equipment + staff).
//   facility  = a hospital, ambulatory surgery centre or other facility (Place_Of_Srvc "F"): the figure is the doctor's professional fee only;
//               the hospital or surgery-centre fee is billed separately and is NOT in it.
//   inpatient = a hospital stay, from the Medicare Inpatient Hospitals file, by MS-DRG: the hospital's total payment for the stay.

import { InputError } from "../../lib/http";

export type Setting = "office" | "facility" | "inpatient";

export interface ServiceEntry {
  id: string;
  /** Plain name used in the answer. */
  label: string;
  /** Phrases that select this entry: every word of one phrase must appear in the request. */
  words: string[];
  /** HCPCS/CPT codes in the Medicare physician file, the headline code first. */
  codes?: string[];
  /** MS-DRG codes in the Medicare inpatient file, the headline DRG first (the others are the severity levels). */
  drgs?: string[];
  /** The setting a plain-words request uses when `setting` is not given. */
  setting: Setting;
}

/** Code -> ProofPrice's own plain label (never a CMS or AMA description). */
export const CODE_LABELS: Record<string, string> = {
  "99212": "established-patient office visit, level 2 (straightforward)",
  "99213": "established-patient office visit, level 3 (low complexity)",
  "99214": "established-patient office visit, level 4 (moderate complexity)",
  "99215": "established-patient office visit, level 5 (high complexity)",
  "99202": "new-patient office visit, level 2 (straightforward)",
  "99203": "new-patient office visit, level 3 (low complexity)",
  "99204": "new-patient office visit, level 4 (moderate complexity)",
  "99205": "new-patient office visit, level 5 (high complexity)",
  "99283": "emergency department visit, level 3",
  "99284": "emergency department visit, level 4",
  "99285": "emergency department visit, level 5",
  G0438: "Medicare annual wellness visit, first",
  G0439: "Medicare annual wellness visit, follow-up",
  G0402: "Welcome to Medicare preventive visit",
  G0008: "flu shot administration fee (the vaccine itself is paid separately)",
  "71045": "chest x-ray, one view",
  "71046": "chest x-ray, two views",
  "72148": "MRI of the lower (lumbar) spine without contrast",
  "72141": "MRI of the neck (cervical) spine without contrast",
  "70551": "MRI of the brain without contrast",
  "73721": "MRI of a leg joint (such as the knee) without contrast",
  "73221": "MRI of an arm joint (such as the shoulder) without contrast",
  "70450": "CT scan of the head without contrast",
  "71250": "CT scan of the chest without contrast",
  "74177": "CT scan of the abdomen and pelvis with contrast",
  "74176": "CT scan of the abdomen and pelvis without contrast",
  "77067": "screening mammogram",
  "77066": "diagnostic mammogram, both breasts",
  "76700": "abdominal ultrasound, complete",
  "76856": "pelvic ultrasound, complete",
  "77080": "bone density scan (DEXA)",
  "93306": "echocardiogram (heart ultrasound), complete",
  "93000": "electrocardiogram (ECG/EKG) with interpretation",
  "93015": "cardiac stress test with supervision and interpretation",
  "78452": "nuclear heart stress test (SPECT)",
  "45378": "colonoscopy, diagnostic",
  G0121: "screening colonoscopy, average risk",
  G0105: "screening colonoscopy, high risk",
  "45380": "colonoscopy with biopsy",
  "45385": "colonoscopy with polyp removal",
  "43235": "upper endoscopy (EGD), diagnostic",
  "43239": "upper endoscopy with biopsy",
  "66984": "cataract surgery with lens implant",
  "29881": "knee arthroscopy (meniscus surgery)",
  "64721": "carpal tunnel release",
  "20610": "large-joint injection (such as the knee)",
  "62323": "lumbar epidural injection with imaging guidance",
  "11102": "skin biopsy (first lesion)",
  "36415": "blood draw (venipuncture)",
  "85025": "complete blood count (CBC)",
  "80053": "comprehensive metabolic panel",
  "80061": "lipid panel (cholesterol and triglycerides)",
  "83036": "hemoglobin A1c test",
  "84443": "TSH thyroid test",
  "81001": "urinalysis with microscopy",
  "82306": "vitamin D test",
  "97110": "physical therapy: therapeutic exercise (per 15 minutes)",
  "97140": "physical therapy: manual therapy (per 15 minutes)",
  "97112": "physical therapy: neuromuscular re-education (per 15 minutes)",
  "97530": "therapeutic activities (per 15 minutes)",
  "97161": "physical therapy evaluation, low complexity",
  "97162": "physical therapy evaluation, moderate complexity",
  "97163": "physical therapy evaluation, high complexity",
  "97165": "occupational therapy evaluation, low complexity",
  "92507": "speech and language therapy session",
  "98940": "chiropractic adjustment, 1-2 spinal regions",
  "98941": "chiropractic adjustment, 3-4 spinal regions",
  "98942": "chiropractic adjustment, 5 spinal regions",
  "90834": "psychotherapy session, 45 minutes",
  "90837": "psychotherapy session, 60 minutes",
  "92014": "comprehensive eye exam, established patient",
  "92004": "comprehensive eye exam, new patient",
  "92134": "retina scan (OCT)",
  "92557": "comprehensive hearing test (audiogram)",
  "95810": "overnight sleep study in a sleep lab",
  "93458": "heart catheterization with coronary angiography",
  "27447": "total knee replacement: the surgeon's fee",
  "27130": "total hip replacement: the surgeon's fee",
};

export const SERVICES: ServiceEntry[] = [
  // ----- visits -----
  { id: "new-patient-visit", label: "new-patient office visit", words: ["new patient visit", "new patient office visit", "first doctor visit"], codes: ["99203", "99204", "99202", "99205"], setting: "office" },
  { id: "er-visit", label: "emergency department visit", words: ["emergency room visit", "er visit", "emergency department visit", "emergency room", "emergency visit"], codes: ["99284", "99283", "99285"], setting: "facility" },
  { id: "annual-wellness", label: "Medicare annual wellness visit", words: ["annual wellness visit", "wellness visit", "annual checkup medicare"], codes: ["G0439", "G0438", "G0402"], setting: "office" },
  { id: "office-visit", label: "established-patient office visit", words: ["office visit", "doctor visit", "doctors visit", "doctor appointment", "gp visit", "primary care visit", "checkup", "check up", "routine visit", "visit to the doctor"], codes: ["99213", "99214", "99212", "99215"], setting: "office" },
  { id: "flu-shot", label: "flu shot administration fee", words: ["flu shot", "flu vaccine", "flu jab", "flu vaccination"], codes: ["G0008"], setting: "office" },
  // ----- scans and tests -----
  { id: "xray-chest", label: "chest x-ray", words: ["chest xray", "chest x ray", "xray chest"], codes: ["71046", "71045"], setting: "office" },
  { id: "mri-lower-back", label: "MRI of the lower back", words: ["mri lower back", "mri lumbar", "mri back", "mri spine", "lumbar spine mri", "back mri", "mri of the back"], codes: ["72148"], setting: "office" },
  { id: "mri-neck", label: "MRI of the neck", words: ["mri neck", "mri cervical", "neck mri"], codes: ["72141"], setting: "office" },
  { id: "mri-brain", label: "MRI of the brain", words: ["mri brain", "mri head", "brain mri", "head mri"], codes: ["70551"], setting: "office" },
  { id: "mri-knee", label: "MRI of the knee", words: ["mri knee", "knee mri", "mri leg joint"], codes: ["73721"], setting: "office" },
  { id: "mri-shoulder", label: "MRI of the shoulder", words: ["mri shoulder", "shoulder mri", "mri arm joint"], codes: ["73221"], setting: "office" },
  { id: "ct-head", label: "CT scan of the head", words: ["ct head", "ct brain", "head ct", "cat scan head", "ct scan head"], codes: ["70450"], setting: "office" },
  { id: "ct-chest", label: "CT scan of the chest", words: ["ct chest", "chest ct", "ct scan chest", "cat scan chest"], codes: ["71250"], setting: "office" },
  { id: "ct-abdomen", label: "CT scan of the abdomen and pelvis", words: ["ct abdomen", "ct abdominal", "ct pelvis", "abdominal ct", "ct scan abdomen", "cat scan abdomen"], codes: ["74177", "74176"], setting: "office" },
  { id: "mammogram", label: "mammogram", words: ["mammogram", "mammography", "breast screening"], codes: ["77067", "77066"], setting: "office" },
  { id: "ultrasound-abdomen", label: "abdominal ultrasound", words: ["abdominal ultrasound", "ultrasound abdomen", "stomach ultrasound"], codes: ["76700"], setting: "office" },
  { id: "ultrasound-pelvis", label: "pelvic ultrasound", words: ["pelvic ultrasound", "ultrasound pelvis"], codes: ["76856"], setting: "office" },
  { id: "bone-density", label: "bone density scan", words: ["bone density", "dexa", "dxa", "osteoporosis scan"], codes: ["77080"], setting: "office" },
  { id: "echo", label: "echocardiogram", words: ["echocardiogram", "echo", "heart ultrasound"], codes: ["93306"], setting: "office" },
  { id: "ecg", label: "electrocardiogram", words: ["ecg", "ekg", "electrocardiogram"], codes: ["93000"], setting: "office" },
  { id: "stress-test", label: "cardiac stress test", words: ["stress test", "cardiac stress test", "treadmill test"], codes: ["93015", "78452"], setting: "office" },
  { id: "sleep-study", label: "sleep study", words: ["sleep study", "sleep test", "polysomnography"], codes: ["95810"], setting: "office" },
  { id: "hearing-test", label: "hearing test", words: ["hearing test", "audiogram", "audiology"], codes: ["92557"], setting: "office" },
  { id: "eye-exam", label: "comprehensive eye exam", words: ["eye exam", "eye test", "eye examination", "optometrist"], codes: ["92014", "92004"], setting: "office" },
  { id: "blood-draw", label: "blood draw", words: ["blood draw", "venipuncture"], codes: ["36415"], setting: "office" },
  { id: "cbc", label: "complete blood count", words: ["cbc", "blood count", "complete blood count"], codes: ["85025"], setting: "office" },
  { id: "metabolic-panel", label: "comprehensive metabolic panel", words: ["metabolic panel", "cmp", "blood chemistry"], codes: ["80053"], setting: "office" },
  { id: "lipid-panel", label: "lipid panel", words: ["lipid panel", "cholesterol test", "cholesterol", "lipid test"], codes: ["80061"], setting: "office" },
  { id: "a1c", label: "hemoglobin A1c test", words: ["a1c", "hba1c", "hemoglobin a1c", "diabetes blood test"], codes: ["83036"], setting: "office" },
  { id: "tsh", label: "thyroid (TSH) test", words: ["tsh", "thyroid test", "thyroid blood test"], codes: ["84443"], setting: "office" },
  { id: "urinalysis", label: "urinalysis", words: ["urinalysis", "urine test"], codes: ["81001"], setting: "office" },
  { id: "vitamin-d", label: "vitamin D test", words: ["vitamin d", "vitamin d test"], codes: ["82306"], setting: "office" },
  // ----- therapy -----
  { id: "pt-evaluation", label: "physical therapy evaluation", words: ["physical therapy evaluation", "physiotherapy evaluation", "pt evaluation", "pt assessment"], codes: ["97162", "97161", "97163"], setting: "office" },
  { id: "ot-evaluation", label: "occupational therapy evaluation", words: ["occupational therapy evaluation", "ot evaluation"], codes: ["97165"], setting: "office" },
  { id: "physical-therapy", label: "physical therapy", words: ["physical therapy", "physiotherapy", "pt session", "physical therapist"], codes: ["97110", "97140", "97112", "97530"], setting: "office" },
  { id: "speech-therapy", label: "speech therapy", words: ["speech therapy", "speech language therapy"], codes: ["92507"], setting: "office" },
  { id: "chiropractic", label: "chiropractic adjustment", words: ["chiropractor", "chiropractic", "chiropractic adjustment", "spinal manipulation"], codes: ["98941", "98940", "98942"], setting: "office" },
  { id: "psychotherapy", label: "psychotherapy session", words: ["psychotherapy", "therapy session", "talk therapy", "counseling session", "counselling session", "psychologist"], codes: ["90834", "90837"], setting: "office" },
  // ----- procedures -----
  { id: "screening-colonoscopy", label: "screening colonoscopy", words: ["screening colonoscopy", "colonoscopy screening"], codes: ["G0121", "G0105"], setting: "facility" },
  { id: "colonoscopy", label: "colonoscopy", words: ["colonoscopy"], codes: ["45378", "45380", "45385", "G0121", "G0105"], setting: "facility" },
  { id: "endoscopy", label: "upper endoscopy", words: ["upper endoscopy", "endoscopy", "egd", "gastroscopy"], codes: ["43235", "43239"], setting: "facility" },
  { id: "cataract", label: "cataract surgery", words: ["cataract surgery", "cataract"], codes: ["66984"], setting: "facility" },
  { id: "knee-arthroscopy", label: "knee arthroscopy", words: ["knee arthroscopy", "meniscus surgery", "arthroscopic knee"], codes: ["29881"], setting: "facility" },
  { id: "carpal-tunnel", label: "carpal tunnel surgery", words: ["carpal tunnel", "carpal tunnel surgery", "carpal tunnel release"], codes: ["64721"], setting: "facility" },
  { id: "joint-injection", label: "joint injection", words: ["joint injection", "cortisone injection", "knee injection", "steroid injection", "cortisone shot"], codes: ["20610"], setting: "office" },
  { id: "epidural", label: "epidural steroid injection", words: ["epidural", "epidural injection", "epidural steroid injection", "spinal injection"], codes: ["62323"], setting: "facility" },
  { id: "skin-biopsy", label: "skin biopsy", words: ["skin biopsy"], codes: ["11102"], setting: "office" },
  { id: "heart-cath", label: "heart catheterization", words: ["heart catheterization", "cardiac catheterization", "cardiac cath", "heart cath", "angiogram heart"], codes: ["93458"], setting: "facility" },
  // ----- joint replacement: hospital stay by default, the surgeon's fee on request -----
  { id: "knee-replacement", label: "knee replacement", words: ["knee replacement", "total knee replacement", "knee joint replacement", "total knee"], drgs: ["470", "469"], codes: ["27447"], setting: "inpatient" },
  { id: "hip-replacement", label: "hip replacement", words: ["hip replacement", "total hip replacement", "hip joint replacement", "total hip"], drgs: ["470", "469"], codes: ["27130"], setting: "inpatient" },
  { id: "joint-revision", label: "hip or knee replacement revision", words: ["revision knee replacement", "revision hip replacement", "joint replacement revision", "knee revision", "hip revision"], drgs: ["467", "468", "466"], setting: "inpatient" },
  // ----- hospital stays (MS-DRG families; the headline DRG is the most common severity level) -----
  { id: "hip-fracture", label: "hip fracture surgery", words: ["hip fracture", "broken hip", "hip fracture surgery"], drgs: ["481", "480", "482"], setting: "inpatient" },
  { id: "spinal-fusion", label: "spinal fusion", words: ["spinal fusion", "spine fusion", "back fusion", "spine surgery"], drgs: ["460", "459"], setting: "inpatient" },
  { id: "pneumonia", label: "pneumonia hospital stay", words: ["pneumonia"], drgs: ["193", "194", "195"], setting: "inpatient" },
  { id: "heart-failure", label: "heart failure hospital stay", words: ["heart failure", "congestive heart failure", "chf"], drgs: ["291", "292", "293"], setting: "inpatient" },
  { id: "heart-attack", label: "heart attack hospital stay", words: ["heart attack", "myocardial infarction", "ami"], drgs: ["280", "281", "282"], setting: "inpatient" },
  { id: "stroke", label: "stroke hospital stay", words: ["stroke", "cerebral infarction", "brain hemorrhage"], drgs: ["065", "064", "066"], setting: "inpatient" },
  { id: "sepsis", label: "sepsis hospital stay", words: ["sepsis", "septicemia"], drgs: ["871", "872"], setting: "inpatient" },
  { id: "copd", label: "COPD hospital stay", words: ["copd", "chronic obstructive pulmonary disease"], drgs: ["190", "191", "192"], setting: "inpatient" },
  { id: "uti", label: "kidney or urinary tract infection hospital stay", words: ["urinary tract infection", "kidney infection", "uti"], drgs: ["690", "689"], setting: "inpatient" },
  { id: "gi-bleed", label: "gastrointestinal bleeding hospital stay", words: ["gi bleed", "gastrointestinal bleeding", "gastrointestinal hemorrhage", "stomach bleeding"], drgs: ["378", "377", "379"], setting: "inpatient" },
  { id: "cellulitis", label: "cellulitis hospital stay", words: ["cellulitis", "skin infection"], drgs: ["603", "602"], setting: "inpatient" },
  { id: "kidney-failure", label: "kidney failure hospital stay", words: ["kidney failure", "renal failure"], drgs: ["683", "682", "684"], setting: "inpatient" },
  { id: "arrhythmia", label: "heart rhythm disorder hospital stay", words: ["arrhythmia", "irregular heartbeat", "atrial fibrillation"], drgs: ["309", "308", "310"], setting: "inpatient" },
  { id: "respiratory-failure", label: "respiratory failure hospital stay", words: ["respiratory failure", "pulmonary edema"], drgs: ["189"], setting: "inpatient" },
  { id: "diabetes-stay", label: "diabetes hospital stay", words: ["diabetes hospital", "diabetes admission", "diabetes hospital stay"], drgs: ["638", "637", "639"], setting: "inpatient" },
  { id: "bypass", label: "coronary bypass surgery (CABG)", words: ["bypass surgery", "coronary bypass", "cabg", "heart bypass", "open heart surgery"], drgs: ["236", "235", "234", "233"], setting: "inpatient" },
  { id: "pacemaker", label: "pacemaker implant", words: ["pacemaker"], drgs: ["243", "242", "244"], setting: "inpatient" },
  { id: "heart-valve", label: "transcatheter heart valve replacement", words: ["heart valve", "tavr", "valve replacement"], drgs: ["267", "266"], setting: "inpatient" },
  { id: "gallbladder", label: "gallbladder removal (laparoscopic)", words: ["gallbladder", "gall bladder", "cholecystectomy"], drgs: ["418", "417", "419"], setting: "inpatient" },
  { id: "colon-surgery", label: "major bowel surgery", words: ["bowel surgery", "colon surgery", "colectomy", "bowel resection"], drgs: ["330", "329", "331"], setting: "inpatient" },
];

// ---------- reading a request ----------

export interface ResolvedService {
  input: string;
  how: "code" | "drg" | "words";
  entry: ServiceEntry | null;
  /** Physician-file codes to look for, the headline first. Empty for an inpatient-only request. */
  codes: string[];
  /** Inpatient-file DRGs, the headline first. Empty for a physician-only request. */
  drgs: string[];
  /** The setting to use when the caller gave none; null when it should be decided from the data (a raw code). */
  setting: Setting | null;
  label: string;
}

const STOP = new Set(["a", "an", "the", "of", "for", "my", "me", "price", "prices", "cost", "costs", "how", "much", "does", "do", "to", "get", "have", "what", "is", "are", "i", "in", "on", "with", "and", "or", "medicare", "average"]);

/** "Knee Replacement!" -> ["knee", "replacement"]; plural s removed; x-ray and cat scan folded. */
export function tokens(s: string): string[] {
  const t = s
    .toLowerCase()
    .replace(/x[\s-]?rays?/g, "xray")
    .replace(/cat[\s-]?scans?/g, "ct")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return t
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const PHRASES: { entry: ServiceEntry; tokens: string[] }[] = SERVICES.flatMap((entry) => entry.words.map((w) => ({ entry, tokens: tokens(w) })));

/** The entry whose phrase has the most words, all present in the request. Ties go to the earlier (more specific) entry. */
export function matchEntry(request: string): ServiceEntry | null {
  const have = new Set(tokens(request));
  if (!have.size) return null;
  let best: { entry: ServiceEntry; score: number } | null = null;
  for (const p of PHRASES) {
    if (!p.tokens.length || !p.tokens.every((t) => have.has(t))) continue;
    const score = p.tokens.length * 10 + (p.tokens.length === have.size ? 5 : 0);
    if (!best || score > best.score) best = { entry: p.entry, score };
  }
  return best ? best.entry : null;
}

/** HCPCS level II (letter + 4 digits) codes are CMS's own; every code that starts with a digit is a CPT(R) code, which is AMA copyright. */
export function isCpt(code: string): boolean {
  return /^\d/.test(code);
}

export function helpText(): string {
  const examples = ["office visit", "MRI lower back", "colonoscopy", "physical therapy", "knee replacement", "pneumonia"];
  return (
    "Give service as plain words (for example " + examples.join(", ") + "), a billing code (a 5-character HCPCS/CPT code such as 99213 for the Medicare physician file), " +
    "or an MS-DRG hospital-stay code (for example DRG 470)."
  );
}

/** A request -> codes, DRGs and the default setting. Throws InputError with the help text when it cannot be understood. */
export function resolveService(raw: string | undefined): ResolvedService {
  const input = (raw ?? "").trim();
  if (!input) throw new InputError(`service is required. ${helpText()}`);

  const drg = /^(?:ms[\s-]?)?drg[\s:#-]*(\d{1,3})$/i.exec(input) ?? /^(\d{3})$/.exec(input);
  if (drg) {
    const code = drg[1].padStart(3, "0");
    const owners = SERVICES.filter((e) => e.drgs?.includes(code));
    const entry = owners.length === 1 ? owners[0] : null; // DRG 470 covers hip and knee: no single plain name
    return { input, how: "drg", entry, codes: [], drgs: [code], setting: "inpatient", label: entry ? `${entry.label} (MS-DRG ${code})` : `MS-DRG ${code}` };
  }

  const code = /^(?:cpt|hcpcs)?[\s:#-]*([0-9]{4}[0-9A-Za-z]|[A-Za-z][0-9]{4})$/i.exec(input);
  if (code) {
    const c = code[1].toUpperCase();
    const entry = SERVICES.find((e) => e.codes?.includes(c)) ?? null;
    const label = CODE_LABELS[c] ?? (isCpt(c) ? `service with CPT code ${c}` : `service with HCPCS code ${c}`);
    // A code the table leads with keeps that entry's usual setting (never "inpatient": the physician file has office and facility only).
    const setting = entry && entry.codes?.[0] === c && entry.setting !== "inpatient" ? entry.setting : null;
    return { input, how: "code", entry, codes: [c], drgs: [], setting, label };
  }

  const entry = matchEntry(input);
  if (!entry) {
    throw new InputError(`'${input}' is not a service we can match yet. ${helpText()}`);
  }
  return { input, how: "words", entry, codes: entry.codes ?? [], drgs: entry.drgs ?? [], setting: entry.setting, label: entry.label };
}
