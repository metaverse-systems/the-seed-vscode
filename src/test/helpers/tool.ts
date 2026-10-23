import { activeToolService } from '../../tool/toolService';
import type { ToolApi } from '../../tool/toolApi';

/** The tool the extension has loaded for this run; throws with the status message when it is not usable. */
export function testTool(): ToolApi {
  const service = activeToolService();
  const api = service.loadedApi();
  if (!api) {
    throw new Error(service.status.message);
  }
  return api;
}
