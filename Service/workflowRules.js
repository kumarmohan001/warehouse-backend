export const fail = (status, message) => { throw Object.assign(new Error(message), { statusCode: status }); };
export const allow = (user, roles) => { if (user.role !== 'admin' && !roles.includes(user.role)) fail(403, 'You do not have access to this action.'); };
export const textValue = (value, label, required = true, max = 1000) => {
  if (value !== undefined && typeof value !== 'string') fail(400, `${label} must be text.`);
  const text = (value || '').trim();
  if (required && !text) fail(400, `${label} is required.`);
  if (text.length > max) fail(400, `${label} must not exceed ${max} characters.`);
  return text;
};
export const positive = (value, label) => {
  if (typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) <= 0) fail(400, `${label} must be greater than zero.`);
  const number = Number(value);
  if (Math.abs(number * 1e6 - Math.round(number * 1e6)) > 0.001) fail(400, `${label} supports up to 6 decimal places.`);
  return number;
};
export const amount = (value) => Math.round(value * 1e6) / 1e6;
export const validDate = (value, label) => { const date = new Date(value); if (!value || Number.isNaN(date.getTime())) fail(400, `${label} must be a valid date.`); return date; };
export const unexpired = (date) => { if (new Date(date).getTime() <= Date.now()) fail(409, 'Expired stock cannot be accepted, dispensed or dispatched.'); };
export const requireState = (record, states) => { if (!states.includes(record.status)) fail(409, `Action unavailable while status is ${record.status}. Refresh the record.`); };
export function requireQc(record, user) {
  allow(user, ['qc-test']);
  if (user.role !== 'admin' && record.qcAssignedTo && String(record.qcAssignedTo) !== String(user._id)) fail(403, 'Only the assigned QC reviewer or QC Manager may perform this action.');
}
export function checkDecision(record, decision, note) {
  if (!['Approved', 'Rejected', 'Hold'].includes(decision)) fail(400, 'Choose Approved, Rejected or Hold.');
  if (['Rejected', 'Hold'].includes(decision) && !note) fail(400, 'A reason is required for rejection or hold.');
  if (decision === 'Hold') return;
  if (!record.sampling?.number) fail(409, 'Sampling details are missing for this batch. Complete Sampling Details first.');
  if (!record.qc?.tests?.length) fail(409, 'No saved test results were found for this batch. Save at least one test in Enter QC test results.');
  if (decision === 'Approved') {
    if (record.documentStatus !== 'Documents OK') fail(409, 'Complete the receiving documents first.');
    if (record.qc.tests.some((test) => test.result !== 'Pass')) fail(409, 'Every test must pass before approval.');
    // Structured results saved on this batch already satisfy the QC Result requirement.
    // A separate copy of those results may be uploaded, but is not required twice.
    for (const kind of ['Test Report (COA)', 'Supporting Documents']) {
      if (!(record.qc.documents || []).some((document) => document.kind === kind && document.fileUrl)) fail(409, `Test results are saved. Upload the missing ${kind} attachment before approval; do not re-enter the tests.`);
    }
  }
  if (decision === 'Rejected' && !record.qc.tests.some((test) => test.result === 'Fail')) fail(409, 'Record a failed test before rejecting the batch.');
}
export function requisitionStatus(record) {
  if (record.issues.some((issue) => issue.status === 'Discrepancy')) return 'Discrepancy';
  const total = amount(record.issues.reduce((sum, issue) => sum + issue.quantity, 0));
  if (total < record.quantity) return total ? 'Partially Dispensed' : 'Pending';
  return record.issues.every((issue) => issue.status === 'Completed') ? 'Completed' : 'Sent to Production';
}
