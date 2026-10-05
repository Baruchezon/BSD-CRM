// Binary agreement mark for licensed-agent anonymous business views.
// Source of truth: businesses.agreement_status (the same field admins edit).
// Only «יש הסכם חתום» counts as signed. «נשלח הסכם לחתימה», «אין הסכם»,
// empty, or any other value is «אין הסכם». The raw status is never printed,
// so a sent-but-unsigned agreement cannot be mistaken for a signed one.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const target = root || (typeof globalThis !== 'undefined' ? globalThis : null);
  if (target) {
    target.anonAgreementIsSigned = api.anonAgreementIsSigned;
    target.anonAgreementLabel = api.anonAgreementLabel;
    target.anonAgreementMark = api.anonAgreementMark;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const SIGNED = 'יש הסכם חתום';
  function anonAgreementIsSigned(status) {
    return status === SIGNED;
  }
  function anonAgreementLabel(status) {
    return anonAgreementIsSigned(status) ? 'יש הסכם' : 'אין הסכם';
  }
  function anonAgreementMark(status) {
    const yes = anonAgreementIsSigned(status);
    const label = anonAgreementLabel(status);
    return `<div class="anon-agr-mark ${yes ? 'yes' : 'no'}" role="status">${label}</div>`;
  }
  return { anonAgreementIsSigned, anonAgreementLabel, anonAgreementMark };
});
