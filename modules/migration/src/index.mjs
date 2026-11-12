export { parseChromeBookmarks, parseBookmarksHTML } from './chrome.mjs';
export { parseArcSidebar } from './arc.mjs';
export { previewBatch, previewUndo } from './batch.mjs';
export { MigrationError } from './common.mjs';

import { assertMigrationPlan } from '../../../contracts/v1/index.mjs';
import { MigrationError } from './common.mjs';
/** Combine separately selected same-format Profile snapshots without merging accounts. */
export function combineMigrationPlans(plans) {
  if (!Array.isArray(plans) || !plans.length) throw new MigrationError('EMPTY_PLAN_LIST');
  for (const plan of plans) assertMigrationPlan(plan);
  if (plans.some(plan => plan.source !== plans[0].source)) throw new MigrationError('MIXED_PLAN_SOURCES');
  const result = structuredClone({version:1,source:plans[0].source,profiles:plans.flatMap(plan=>plan.profiles),warnings:plans.flatMap(plan=>plan.warnings)});
  return assertMigrationPlan(result);
}
