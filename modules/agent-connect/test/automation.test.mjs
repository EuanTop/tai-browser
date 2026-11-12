import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, requireAutomationCapability } from '../../automation-connect/capabilities.mjs';
test('Codex chat does not advertise unverified scheduler or durable event delivery', () => {
  for (const key of ['schedule','listSchedules','cancelSchedule','eventDelivery','durableAcknowledgements']) {
    assert.equal(capabilities[key], false);
    assert.deepEqual(requireAutomationCapability(key), { ok: false, error: {
      code: 'CHANNEL_CAPABILITY_UNAVAILABLE', retryable: false,
    } });
  }
});
