import { fail } from './workflowRules.js';

export function documentCategories(body, kind, count) {
  const allowed = kind === 'qc' ? ['Test Report (COA)', 'QC Result', 'Supporting Documents'] : ['FG Documents'];
  let categories;
  if (body.documentKinds !== undefined) {
    try { categories = JSON.parse(body.documentKinds); }
    catch { fail(400, 'Invalid document categories. Select the files again.'); }
  } else categories = Array(count).fill(body.documentKind);
  if (!Array.isArray(categories) || categories.length !== count || categories.some((category) => !allowed.includes(category))) {
    fail(400, 'Choose a valid category for every uploaded file.');
  }
  return categories;
}
