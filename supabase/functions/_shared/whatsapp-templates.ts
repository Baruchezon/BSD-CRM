// BSD WhatsApp Cloud API - message templates (single source of truth).
// Used by: whatsapp-send (building the send payload), scripts/whatsapp/submit-templates.mjs (Graph API
// submission), the CRM template picker (via whatsapp-send action list_templates), and the tests.
// Rules: Hebrew (language "he"), no passwords / prices / phone numbers in any template.
// WhatsApp display name (Meta business profile, shown above every message): «BSD מכירת עסקים».
// Template footer (the line under the message body): «BSD Business Brokers Israel».
// Marketing templates start with the word «פרסומת» and carry a removal option (Israeli spam law, section 30A).

export const DISPLAY_NAME = 'BSD מכירת עסקים';
export const TEMPLATE_FOOTER = 'BSD Business Brokers Israel';
export const OPT_OUT_PAYLOAD = 'BSD_OPT_OUT';
export const OPT_OUT_TEXT = 'הסר אותי';

export type TemplateCategory = 'UTILITY' | 'MARKETING';
export type Audience = 'any' | 'buyer' | 'business_owner' | 'agreement' | 'training';

export interface TemplateParam { key: string; label: string; example: string; max: number }
export interface QuickReply { text: string; payload: string }
export interface TemplateDef {
  name: string;
  category: TemplateCategory;
  language: 'he';
  audience: Audience;
  description: string;          // Hebrew, shown in the CRM picker
  header?: 'DOCUMENT';          // document header: a PDF supplied at send time
  body: string;                 // {{1}}..{{n}} in order, never at the very start/end
  params: TemplateParam[];
  footer: string;
  urlButton?: { text: string; exampleCode: string }; // URL = <SHORT_LINK_BASE>{{1}}, {{1}} = short-link code
  quickReplies: QuickReply[];
  needsAgreementPermission?: boolean;
  fixedValues?: Record<string, Record<string, string>>; // param key -> allowed code -> text (keeps utility)
}

const optOut: QuickReply = { text: OPT_OUT_TEXT, payload: OPT_OUT_PAYLOAD };

export const BUYER_UPDATE_CODES: Record<string, string> = {
  form_received: 'קיבלנו את הטופס שמילאת והבקשה בטיפול',
  documents_received: 'קיבלנו את המסמכים ששלחת',
  documents_sent: 'שלחנו אליך את המסמכים שביקשת',
  call_soon: 'נציג BSD יתקשר אליך בימים הקרובים',
  details_needed: 'חסר לנו פרט כדי להמשיך בטיפול',
  meeting_set: 'הפגישה שביקשת נקבעה ופרטיה יישלחו בנפרד',
};
export const AGREEMENT_KIND_LABELS: Record<string, string> = {
  seller: 'מכירת עסק', buyer: 'רכישת עסק', broker: 'שיתוף פעולה', partner: 'שותפות בעסק',
};

export const TEMPLATES: Record<string, TemplateDef> = {
  bsd_agreement_to_sign: {
    name: 'bsd_agreement_to_sign', category: 'UTILITY', language: 'he', audience: 'agreement', needsAgreementPermission: true,
    description: 'שליחת הסכם התקשרות לחתימה (כפתור «לצפייה וחתימה»)',
    body: 'שלום {{1}}, הסכם ההתקשרות שלך עם BSD בנושא {{2}} מוכן לחתימה. אפשר לעיין בהסכם ולחתום עליו דיגיטלית בלחיצה על «לצפייה וחתימה». לשאלות אפשר להשיב להודעה זו.',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'agreement_kind', label: 'סוג ההסכם', example: 'מכירת עסק', max: 30 },
    ],
    footer: TEMPLATE_FOOTER, urlButton: { text: 'לצפייה וחתימה', exampleCode: 'Ab3kD9xQ' }, quickReplies: [optOut],
    fixedValues: { agreement_kind: AGREEMENT_KIND_LABELS },
  },
  bsd_signing_reminder: {
    name: 'bsd_signing_reminder', category: 'UTILITY', language: 'he', audience: 'agreement', needsAgreementPermission: true,
    description: 'תזכורת לחתימה על הסכם שנשלח',
    body: 'שלום {{1}}, תזכורת: הסכם ההתקשרות עם BSD שנשלח אליך בתאריך {{2}} עדיין ממתין לחתימה. אפשר לחתום בלחיצה על «לצפייה וחתימה». אם כבר חתמת, אין צורך לעשות דבר.',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'sent_date', label: 'תאריך שליחה', example: '11.10.2026', max: 10 },
    ],
    footer: TEMPLATE_FOOTER, urlButton: { text: 'לצפייה וחתימה', exampleCode: 'Ab3kD9xQ' }, quickReplies: [optOut],
  },
  bsd_agreement_signed_copy: {
    name: 'bsd_agreement_signed_copy', category: 'UTILITY', language: 'he', audience: 'agreement', header: 'DOCUMENT',
    description: 'העתק ההסכם החתום ללקוח (PDF מצורף)',
    body: 'שלום {{1}}, תודה! ההסכם עם BSD נחתם בהצלחה. מצורף העתק ההסכם החתום (מספר הסכם {{2}}) לשמירה אצלך.',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'agreement_number', label: 'מספר הסכם', example: 'BSD-2026-1042', max: 40 },
    ],
    footer: TEMPLATE_FOOTER, quickReplies: [],
  },
  bsd_files_ready: {
    name: 'bsd_files_ready', category: 'UTILITY', language: 'he', audience: 'any', header: 'DOCUMENT',
    description: 'שליחת מסמך שהלקוח ביקש (PDF מצורף)',
    body: 'שלום {{1}}, בהמשך לבקשתך מצורף המסמך {{2}}. לשאלות אפשר להשיב להודעה זו.',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'document_title', label: 'שם המסמך', example: 'תיק מכירה', max: 50 },
    ],
    footer: TEMPLATE_FOOTER, quickReplies: [optOut],
  },
  bsd_meeting_summary: {
    name: 'bsd_meeting_summary', category: 'UTILITY', language: 'he', audience: 'any',
    description: 'סיכום פגישה (טקסט קצר, ללא שורות חדשות)',
    body: 'שלום {{1}}, תודה על הפגישה בתאריך {{2}}. עיקרי הדברים: {{3}}. נשמח להמשיך בטיפול, ולשאלות אפשר להשיב להודעה זו.',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'meeting_date', label: 'תאריך הפגישה', example: '11.10.2026', max: 10 },
      { key: 'summary', label: 'עיקרי הדברים', example: 'עברנו על הדוחות הכספיים וסיכמנו על ביקור בעסק', max: 500 },
    ],
    footer: TEMPLATE_FOOTER, quickReplies: [optOut],
  },
  bsd_buyer_update: {
    name: 'bsd_buyer_update', category: 'UTILITY', language: 'he', audience: 'buyer',
    description: 'עדכון סטטוס לקונה (נוסח קבוע לבחירה)',
    body: 'שלום {{1}}, עדכון לגבי הפנייה שלך ל-BSD (מספר לקוח {{2}}): {{3}}. לפרטים נוספים אפשר להשיב להודעה זו.',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'client_number', label: 'מספר לקוח', example: '1042', max: 20 },
      { key: 'update_code', label: 'העדכון', example: 'קיבלנו את המסמכים ששלחת', max: 80 },
    ],
    footer: TEMPLATE_FOOTER, quickReplies: [optOut], fixedValues: { update_code: BUYER_UPDATE_CODES },
  },
  bsd_portal_access: {
    name: 'bsd_portal_access', category: 'UTILITY', language: 'he', audience: 'business_owner',
    description: 'קישור כניסה לאזור האישי של בעל העסק (בלי סיסמה)',
    body: 'שלום {{1}}, פתחנו עבורך אזור אישי מאובטח ב-BSD, שבו אפשר לצפות במסמכים ובעדכונים של העסק שלך. להפעלת החשבון ולכניסה לוחצים על «כניסה לאזור האישי». הקישור אישי, נא לא להעביר אותו לאחרים.',
    params: [{ key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 }],
    footer: TEMPLATE_FOOTER, urlButton: { text: 'כניסה לאזור האישי', exampleCode: 'Ab3kD9xQ' }, quickReplies: [optOut],
  },
  bsd_vip_access: {
    name: 'bsd_vip_access', category: 'UTILITY', language: 'he', audience: 'buyer',
    description: 'קישור כניסה לאזור לקוחות VIP (בלי סיסמה)',
    body: 'שלום {{1}}, נפתחה עבורך גישה לאזור לקוחות VIP של BSD, שבו מוצגים העסקים שהתאמנו עבורך. לכניסה לוחצים על «כניסה לאזור VIP». הקישור אישי, נא לא להעביר אותו לאחרים.',
    params: [{ key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 }],
    footer: TEMPLATE_FOOTER, urlButton: { text: 'כניסה לאזור VIP', exampleCode: 'Ab3kD9xQ' }, quickReplies: [optOut],
  },
  bsd_lead_followup: {
    name: 'bsd_lead_followup', category: 'UTILITY', language: 'he', audience: 'any',
    description: 'מענה לפנייה חדשה ותיאום שיחה',
    body: 'שלום {{1}}, קיבלנו את פנייתך ל-BSD בנושא {{2}}. נשמח לתאם איתך שיחה קצרה. מתי נוח לך?',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'topic', label: 'נושא הפנייה', example: 'מכירת עסק', max: 40 },
    ],
    footer: TEMPLATE_FOOTER,
    quickReplies: [{ text: 'היום', payload: 'CALL_TODAY' }, { text: 'מחר', payload: 'CALL_TOMORROW' }, { text: 'אחזור אליכם', payload: 'CALL_LATER' }, optOut],
  },
  bsd_training_form: {
    name: 'bsd_training_form', category: 'UTILITY', language: 'he', audience: 'training',
    description: 'קישור אישי לטופס הרישום להכשרה',
    body: 'שלום {{1}}, בהמשך להתעניינותך בהכשרת מתווכי העסקים של BSD, זה הקישור האישי לטופס הרישום. אפשר להשיב להודעה זו עם כל שאלה.',
    params: [{ key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 }],
    footer: TEMPLATE_FOOTER, urlButton: { text: 'לטופס הרישום', exampleCode: 'Ab3kD9xQ' }, quickReplies: [optOut],
  },
  bsd_anon_offer: {
    name: 'bsd_anon_offer', category: 'MARKETING', language: 'he', audience: 'buyer', header: 'DOCUMENT',
    description: 'פרסומת: הצעת עסק חדש עם תקציר אנונימי (רק למי שאישר פרסומת)',
    body: 'פרסומת: שלום {{1}}, יש ב-BSD עסק חדש שעשוי להתאים לך: {{2}}. מצורף תקציר אנונימי. מעוניין בפרטים נוספים? אפשר ללחוץ «כן, מעוניין». להסרה מרשימת התפוצה לוחצים «הסר אותי».',
    params: [
      { key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 },
      { key: 'business_teaser', label: 'תיאור קצר (אנונימי)', example: 'בית קפה במרכז הארץ', max: 60 },
    ],
    footer: TEMPLATE_FOOTER, quickReplies: [{ text: 'כן, מעוניין', payload: 'ANON_INTERESTED' }, optOut],
  },
  bsd_training_brochure: {
    name: 'bsd_training_brochure', category: 'MARKETING', language: 'he', audience: 'training', header: 'DOCUMENT',
    description: 'פרסומת: ברושור ההכשרה (PDF מצורף, רק למי שאישר פרסומת)',
    body: 'פרסומת: שלום {{1}}, מצורף הברושור של הכשרת מתווכי העסקים של BSD, עם כל הפרטים על התוכנית. להרשמה או לשאלות אפשר להשיב להודעה זו. להסרה מרשימת התפוצה לוחצים «הסר אותי».',
    params: [{ key: 'first_name', label: 'שם פרטי', example: 'דני', max: 30 }],
    footer: TEMPLATE_FOOTER, quickReplies: [optOut],
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

export function renderTemplateText(def: TemplateDef, values: string[]): string {
  return def.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => values[Number(n) - 1] ?? '') + '\n' + def.footer;
}

// Payload for POST https://graph.facebook.com/<ver>/<WABA_ID>/message_templates
// shortLinkBase: the fixed URL prefix of every URL button, e.g. https://<ref>.supabase.co/functions/v1/go/
// documentHandle: the "header_handle" example from the Resumable Upload API (needed only for DOCUMENT headers).
export function submissionPayload(def: TemplateDef, shortLinkBase: string, documentHandle?: string) {
  const components: Record<string, unknown>[] = [];
  if (def.header === 'DOCUMENT') {
    components.push({ type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [documentHandle || '<HEADER_HANDLE_FROM_RESUMABLE_UPLOAD>'] } });
  }
  components.push({ type: 'BODY', text: def.body, example: { body_text: [def.params.map(p => p.example)] } });
  components.push({ type: 'FOOTER', text: def.footer });
  const buttons: Record<string, unknown>[] = [];
  if (def.urlButton) buttons.push({ type: 'URL', text: def.urlButton.text, url: shortLinkBase + '{{1}}', example: [shortLinkBase + def.urlButton.exampleCode] });
  for (const q of def.quickReplies) buttons.push({ type: 'QUICK_REPLY', text: q.text });
  if (buttons.length) components.push({ type: 'BUTTONS', buttons });
  return { name: def.name, language: def.language, category: def.category, parameter_format: 'POSITIONAL', components };
}

// Static checks Meta also applies (run in the tests so a rejected template is caught before submission).
export function lintTemplate(def: TemplateDef): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(def.name)) errs.push('bad name');
  const nums = [...def.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  nums.forEach((n, i) => { if (n !== i + 1) errs.push('params not sequential'); });
  if (nums.length !== def.params.length) errs.push('param count mismatch');
  if (/^\s*\{\{/.test(def.body) || /\{\{\d+\}\}[\s.]*$/.test(def.body)) errs.push('variable at start/end');
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(def.body)) errs.push('adjacent variables');
  if (def.body.length > 1024) errs.push('body too long');
  if (def.footer.length > 60) errs.push('footer too long');
  if (/סיסמ|password/i.test(def.body)) errs.push('password mentioned');
  if (/₪|\d{3}-?\d{7}|https?:\/\//.test(def.body)) errs.push('price/phone/url in body');
  if (def.category === 'MARKETING' && !def.body.startsWith('פרסומת')) errs.push('marketing must start with פרסומת');
  if (def.category === 'MARKETING' && !def.quickReplies.some(q => q.payload === OPT_OUT_PAYLOAD)) errs.push('marketing needs opt-out');
  if (def.quickReplies.length + (def.urlButton ? 1 : 0) > 10) errs.push('too many buttons');
  def.quickReplies.forEach(q => { if (q.text.length > 25) errs.push('quick reply too long'); });
  if (def.urlButton && def.urlButton.text.length > 25) errs.push('url button text too long');
  return errs;
}
