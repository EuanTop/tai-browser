// Synthetic host only. This is not the installed TAi native backend.
import { serveStdio } from '../../bridge.mjs';
await serveStdio({
  binding: { profileId: 'fixture-profile', spaceId: 'fixture-space', taskId: 'fixture-task' },
  tools: [{ name: 'tai_preview', command: 'modules.preview', description: 'Preview a synthetic front-end module',
    inputSchema: { type: 'object', properties: { moduleId: { type: 'string' }, version: { type: 'string' } },
      required: ['moduleId', 'version'], additionalProperties: false } }],
  host: { execute: async request => ({ id: request.id, ok: true,
    value: { previewId: 'synthetic-preview', scope: request.scope, moduleId: request.payload.moduleId } }) },
});
