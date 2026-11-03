// Shared sale-file send decisions for send-sale-files-to-buyer and
// get-sale-files-signed-links. Pure: no network, no Deno APIs.
// Email and WhatsApp must apply the same confidentiality rule.

export function missingSaleFileEmailMessage(recipientType) {
  if (recipientType === 'broker') return 'למתווך הזה אין כתובת אימייל שמורה - יש להוסיף אחת בכרטיס המתווך קודם';
  if (recipientType === 'owner') return 'לבעל העסק הזה אין כתובת אימייל שמורה - יש להוסיף אחת בכרטיס העסק (לשונית בעלים) קודם';
  return 'לקונה הזה אין כתובת אימייל שמורה - יש להוסיף אחת בכרטיס הקונה קודם';
}

export function recipientHasSignedAgreement(recipientType, agreementStatus) {
  if (recipientType === 'owner') return true;
  return agreementStatus === 'יש הסכם חתום';
}

// files must already be the rows loaded for this business (active only).
// Fail closed: a confidential file is never dropped silently.
export function evaluateSaleFileAccess({ recipientType, agreementStatus, file_ids, files }) {
  const foundIds = new Set((files || []).map((f) => f.id));
  const missing = (file_ids || []).filter((id) => !foundIds.has(id));
  if (missing.length) {
    return {
      ok: false,
      status: 400,
      reason: 'file_not_found_or_inactive',
      missing,
      error: 'קובץ אחד או יותר לא נמצא בתיק המכירה של העסק הזה (ייתכן שנמחק) - רענן ונסה שוב',
    };
  }
  const signed = recipientHasSignedAgreement(recipientType, agreementStatus);
  const disallowed = (files || []).filter((f) => !signed && Number(f.confidentiality_level) === 2);
  if (disallowed.length) {
    const who = recipientType === 'broker' ? 'למתווך' : recipientType === 'owner' ? 'לבעל העסק' : 'לקונה';
    const names = disallowed.map((f) => f.file_name).join(', ');
    return {
      ok: false,
      status: 403,
      reason: 'confidentiality_blocked',
      signed,
      disallowed,
      error: `לא ניתן לשלוח את הקבצים הבאים: ${names}. ${who} אין הסכם סודיות חתום.`,
    };
  }
  return { ok: true, signed };
}
