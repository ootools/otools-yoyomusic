import type { PlaybackSlice, SettingsSlice, UiSlice, PlayMode } from '../state/store';
import type { LyricsDocument } from '../lyrics/resolve';
import type { SignalFrame } from '../signal/engine';

export type DataAction =
  | { type: 'like'; id: string }
  | { type: 'playlist-create'; name?: string }
  | { type: 'playlist-rename'; id: string; name: string }
  | { type: 'playlist-delete' | 'playlist-switch'; id: string }
  | { type: 'playlist-add' | 'playlist-remove'; id: string; trackId: string }
  | { type: 'queue-next' | 'queue-append'; id: string }
  | { type: 'queue-move'; id: string; delta: 1 | -1 }
  | { type: 'settings'; patch: Partial<SettingsSlice> }
  | { type: 'play-mode'; mode: PlayMode }
  | { type: 'eq'; enabled: boolean; bands?: number[] }
  | { type: 'volume'; value: number }
  | { type: 'mute'; value: boolean }
  | { type: 'window-position'; id: string; x: number; y: number }
  | { type: 'crawl-cancel' };
export type PlayerCommand = { op: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seek' | 'volume' | 'mute' | 'setTrack'; arg?: unknown };
export interface RuntimeState {
  loading: boolean; ready: boolean; picking?: boolean; error: string | null; owner: string | null;
  lyrics: LyricsDocument; updatedAt: number; route: 'panel' | 'main' | 'lyrics';
}
export interface AppRuntime {
  command(command: PlayerCommand): void;
  action(action: DataAction): void;
  patchUi(patch: Partial<UiSlice>): void;
  importFiles(): Promise<void>;
  importFolder(): Promise<void>;
  importPaths(paths: string[]): void;
  openWindow(id: 'yoyomusic-main' | 'yoyomusic-lyrics'): Promise<void>;
  getState(): RuntimeState;
  subscribe(listener: () => void): () => void;
  getFrame(): SignalFrame;
  position(): number;
  clearError(): void;
  windowPosition?(id: string): { x: number; y: number } | undefined;
  start(): Promise<void>;
  shutdown?(): Promise<void>;
  dispose(): void;
}
export interface PlaybackPacket { playback: PlaybackSlice; lyrics: LyricsDocument; loading: boolean; sentAt: number; }
