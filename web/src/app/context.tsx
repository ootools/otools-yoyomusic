import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AppRuntime } from './actions';
const Context = createContext<AppRuntime | null>(null);
export function RuntimeProvider({ runtime, children }: { runtime: AppRuntime; children: ReactNode }) {
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function useRuntime(): AppRuntime {
  const runtime = useContext(Context);
  if (!runtime) throw new Error('YoYoMusic runtime provider is missing');
  return runtime;
}
export function useRuntimeState() {
  const runtime = useRuntime();
  return useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
}
