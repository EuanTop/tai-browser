// Shared reader business logic, never a second renderer/parser implementation.
import {mountReader} from '../../../modules/readers/index.mjs';
const input=globalThis.taiSurfaceInput;
await mountReader(document.querySelector('main'),input,{copyPath:path=>globalThis.taiReaderActions.copyPath(path)});
