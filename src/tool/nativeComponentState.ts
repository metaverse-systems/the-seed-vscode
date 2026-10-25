import type { ToolApi } from './toolApi';

/** Whether the tool's native component can be loaded, and the tool's own text when it cannot. */
export type NativeComponentState = { built: true } | { built: false; message: string };

/** Asks the tool to load its native component, which changes nothing, and reports the outcome. */
export function nativeComponentState(api: Pick<ToolApi, 'requireNativeComponent' | 'NativeComponentMissingError' | 'nativeComponentMessage'>): NativeComponentState {
  try {
    api.requireNativeComponent();
    return { built: true };
  } catch (error) {
    if (error instanceof api.NativeComponentMissingError) {
      return { built: false, message: error.message };
    }
    return { built: false, message: api.nativeComponentMessage(error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)) };
  }
}
