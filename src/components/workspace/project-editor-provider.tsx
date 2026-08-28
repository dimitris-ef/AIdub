"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Project-level playback and selection state.
 *
 * Part 1 reserved room in the workspace layout for a persistent player and
 * timeline; this is where that becomes real. Transcript uses it today, and
 * Translate, Voices, Mix and Export can consume the same state without each
 * inventing its own player wiring.
 *
 * The design point that matters is **isolation of the playhead**. Playback
 * time changes tens of times a second; segment selection changes when a person
 * clicks. Putting both in React state would re-render every transcript row —
 * and every open textarea — on every frame. So time lives in a tiny external
 * store that only the components that draw a playhead subscribe to, while
 * selection and the active segment id are ordinary state that changes rarely.
 */

interface TimeSnapshot {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}

interface TimeStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TimeSnapshot;
  set: (partial: Partial<TimeSnapshot>) => void;
}

function createTimeStore(): TimeStore {
  let snapshot: TimeSnapshot = {
    currentTime: 0,
    duration: 0,
    isPlaying: false,
  };
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    set(partial) {
      const next = { ...snapshot, ...partial };

      if (
        next.currentTime === snapshot.currentTime &&
        next.duration === snapshot.duration &&
        next.isPlaying === snapshot.isPlaying
      ) {
        return;
      }

      snapshot = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export interface ProjectEditorContextValue {
  /** Set by the player once it is mounted; used for seek/play/pause. */
  registerMedia: (element: HTMLMediaElement | null) => void;
  /** Reports playback state upward without re-rendering consumers. */
  reportTime: (partial: Partial<TimeSnapshot>) => void;
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** Chosen by a person; never moved by playback. */
  selectedSegmentId: string | null;
  selectSegment: (segmentId: string | null) => void;
  /** Derived from playback position. */
  activeSegmentId: string | null;
  setActiveSegmentId: (segmentId: string | null) => void;
  timeStore: TimeStore;
}

const ProjectEditorContext = createContext<ProjectEditorContextValue | null>(
  null,
);

export function ProjectEditorProvider({ children }: { children: ReactNode }) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  // Created once and never replaced: the store lives outside React's render
  // cycle on purpose, so playback time can change without re-rendering here.
  const [timeStore] = useState(createTimeStore);

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  const registerMedia = useCallback((element: HTMLMediaElement | null) => {
    mediaRef.current = element;
  }, []);

  const reportTime = useCallback(
    (partial: Partial<TimeSnapshot>) => timeStore.set(partial),
    [timeStore],
  );

  const seek = useCallback(
    (time: number) => {
      const media = mediaRef.current;

      if (!media || !Number.isFinite(time) || time < 0) {
        return;
      }

      // The browser may land on a nearby keyframe; that is normal and never
      // written back to the dialogue's own timestamps.
      media.currentTime = time;
      timeStore.set({ currentTime: time });
    },
    [timeStore],
  );

  const play = useCallback(() => {
    void mediaRef.current?.play().catch(() => {
      // Autoplay policies can refuse; the user can press play themselves.
    });
  }, []);

  const pause = useCallback(() => mediaRef.current?.pause(), []);

  const togglePlay = useCallback(() => {
    if (timeStore.getSnapshot().isPlaying) {
      mediaRef.current?.pause();
      return;
    }

    void mediaRef.current?.play().catch(() => {});
  }, [timeStore]);

  const value = useMemo<ProjectEditorContextValue>(
    () => ({
      registerMedia,
      reportTime,
      seek,
      play,
      pause,
      togglePlay,
      selectedSegmentId,
      selectSegment: setSelectedSegmentId,
      activeSegmentId,
      setActiveSegmentId,
      timeStore,
    }),
    [
      registerMedia,
      reportTime,
      seek,
      play,
      pause,
      togglePlay,
      selectedSegmentId,
      activeSegmentId,
      timeStore,
    ],
  );

  return (
    <ProjectEditorContext.Provider value={value}>
      {children}
    </ProjectEditorContext.Provider>
  );
}

export function useProjectEditor(): ProjectEditorContextValue {
  const value = useContext(ProjectEditorContext);

  if (!value) {
    throw new Error(
      "useProjectEditor must be used inside a ProjectEditorProvider.",
    );
  }

  return value;
}

/**
 * Subscribes to playback time. Only call this from something that actually
 * draws the playhead — every consumer re-renders as the video plays.
 */
export function usePlaybackTime(): TimeSnapshot {
  const { timeStore } = useProjectEditor();

  return useSyncExternalStore(
    timeStore.subscribe,
    timeStore.getSnapshot,
    timeStore.getSnapshot,
  );
}

/** Whether playback is running, without subscribing to the time itself. */
export function useIsPlaying(): boolean {
  const { timeStore } = useProjectEditor();

  return useSyncExternalStore(
    timeStore.subscribe,
    () => timeStore.getSnapshot().isPlaying,
    () => false,
  );
}

/** The media duration, which changes once per load rather than per frame. */
export function useMediaDuration(): number {
  const { timeStore } = useProjectEditor();

  return useSyncExternalStore(
    timeStore.subscribe,
    () => timeStore.getSnapshot().duration,
    () => 0,
  );
}
