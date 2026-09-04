import path from "node:path";

import type { TtsVoice } from "@/types/tts";

/**
 * The voice catalog for the local VITS provider.
 *
 * Piper models are files on disk, not a service: there is no voice-list
 * endpoint to call, and a `.onnx` says how many speakers it has but not what
 * any of them should be called. So the adapter answers from a configured static
 * catalog instead — which the provider abstraction explicitly allows, and which
 * is the same thing a hosted provider's voice list is, only written down here.
 *
 * A voice is `<model directory>:<speaker id>`. That id is what a
 * `SpeakerVoiceAssignment` stores, so it has to stay stable across restarts:
 * it is derived from the model name and the model's own speaker index, never
 * from this array's order.
 *
 * The names are **arbitrary labels for anonymous voices**. LibriTTS-R speaker
 * 12 is a numbered voice in a public dataset; calling it "Voice 12" is a way to
 * tell it apart from voice 47 in a dropdown. Nothing here claims, infers or
 * records any attribute of a person — not gender, not age, not identity — and
 * Aidub never picks a voice from an inferred attribute of a speaker. Choosing
 * is a person's job, by ear.
 */

export interface LocalVitsVoiceDefinition {
  /** Stable voice id, and the only thing an assignment persists. */
  id: string;
  name: string;
  /** Directory under the model root holding the ONNX, tokens and espeak data. */
  modelDirectory: string;
  /** Base name of the `.onnx` file inside that directory. */
  modelFile: string;
  /** VITS speaker index passed to the model. 0 for single-speaker models. */
  speakerId: number;
  languageCodes: string[];
  description: string;
}

/**
 * A handful of LibriTTS-R speakers rather than all 904.
 *
 * The model can speak as any of them, but a dropdown with 904 numbered entries
 * is not a choice a person can make. Six audibly distinct voices is enough to
 * cast a scene, and adding more is one line each.
 */
const LIBRITTS_SPEAKERS = [16, 79, 125, 233, 587, 803];

function libriTtsVoices(): LocalVitsVoiceDefinition[] {
  return LIBRITTS_SPEAKERS.map((speakerId) => ({
    id: `vits-piper-en_US-libritts_r-medium:${speakerId}`,
    name: `English voice ${speakerId}`,
    modelDirectory: "vits-piper-en_US-libritts_r-medium",
    modelFile: "en_US-libritts_r-medium.onnx",
    speakerId,
    languageCodes: ["en", "en-US"],
    description: "LibriTTS-R multi-speaker English (Piper VITS)",
  }));
}

export const LOCAL_VITS_CATALOG: LocalVitsVoiceDefinition[] = [
  ...libriTtsVoices(),
  {
    id: "vits-piper-pl_PL-darkman-medium:0",
    name: "Polish voice — Darkman",
    modelDirectory: "vits-piper-pl_PL-darkman-medium",
    modelFile: "pl_PL-darkman-medium.onnx",
    speakerId: 0,
    languageCodes: ["pl", "pl-PL"],
    description: "Single-speaker Polish (Piper VITS)",
  },
  {
    id: "vits-piper-pl_PL-gosia-medium:0",
    name: "Polish voice — Gosia",
    modelDirectory: "vits-piper-pl_PL-gosia-medium",
    modelFile: "pl_PL-gosia-medium.onnx",
    speakerId: 0,
    languageCodes: ["pl", "pl-PL"],
    description: "Single-speaker Polish (Piper VITS)",
  },
];

export function findLocalVitsVoice(
  voiceId: string,
): LocalVitsVoiceDefinition | null {
  return LOCAL_VITS_CATALOG.find((voice) => voice.id === voiceId) ?? null;
}

/** Filesystem locations for one catalog entry, under a model root. */
export function localVitsModelPaths(
  modelRoot: string,
  definition: LocalVitsVoiceDefinition,
): { model: string; tokens: string; dataDir: string; directory: string } {
  // Every path is built from the catalog's own constants joined onto the
  // configured root — never from a request value, so no id a caller supplies
  // can reach outside the model directory.
  const directory = path.join(modelRoot, definition.modelDirectory);

  return {
    directory,
    model: path.join(directory, definition.modelFile),
    tokens: path.join(directory, "tokens.txt"),
    dataDir: path.join(directory, "espeak-ng-data"),
  };
}

/** The catalog entry as the domain's normalised voice shape. */
export function toTtsVoice(
  definition: LocalVitsVoiceDefinition,
  providerId: string,
): TtsVoice {
  return {
    id: definition.id,
    providerId,
    name: definition.name,
    languageCodes: [...definition.languageCodes],
    // The local models publish no such descriptor, and Aidub never invents one.
    gender: null,
    description: definition.description,
    previewUrl: null,
    metadata: {
      modelDirectory: definition.modelDirectory,
      speakerId: definition.speakerId,
    },
  };
}
