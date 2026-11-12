/** Codex App Server chat does not establish an API for schedules or event acknowledgements. */
export const capabilities = Object.freeze({
  channel: 'codex-app-server', schedule: false, listSchedules: false, cancelSchedule: false,
  eventDelivery: false, durableAcknowledgements: false,
  reason: 'No verified scheduling or durable event-delivery API in this adapter. Use the original Agent entry point.',
});
export function requireAutomationCapability(name) {
  if (!['schedule','listSchedules','cancelSchedule','eventDelivery','durableAcknowledgements'].includes(name) || !capabilities[name])
    return { ok: false, error: { code: 'CHANNEL_CAPABILITY_UNAVAILABLE', retryable: false } };
  return { ok: true };
}
