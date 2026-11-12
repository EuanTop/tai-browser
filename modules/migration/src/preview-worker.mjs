import { runPreviewJob } from './preview-job.mjs';

// A dedicated worker per job. terminate(), not an abort message, interrupts CPU work.
self.onmessage = async ({ data }) => {
  try {
    const preview = await runPreviewJob(data.input, () => self.postMessage({ jobId: data.jobId, phase: 'parsing' }));
    self.postMessage({ jobId: data.jobId, preview });
  } catch (error) {
    self.postMessage({ jobId: data.jobId, error: /^[A-Z_]+$/u.test(error.code ?? '') ? error.code : 'PREVIEW_FAILED' });
  }
};