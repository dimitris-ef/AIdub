import type { DialogueSpeaker } from "@/types/dialogue";
import type { DialogueTranslation } from "@/types/translation";
import { formatRelativeTime } from "@/lib/dates";
import { getLanguageLabel } from "@/lib/languages";
import { Separator } from "@/components/ui/separator";
import { TranslationSegmentRow } from "@/components/translate/translation-segment-row";

/**
 * A completed translation, read-only.
 *
 * Deliberately plain. Part 9's job is to prove the backend contract holds —
 * every dialogue line present exactly once, in timeline order, with its speaker
 * and timing intact and the source text beside the translation. The editing
 * workflow belongs to Part 10 and would obscure that here.
 */
export function TranslationPreview({
  translation,
  speakers,
}: {
  translation: DialogueTranslation;
  speakers: readonly DialogueSpeaker[];
}) {
  const translatedCount = translation.segments.filter(
    (segment) => segment.translatedText.trim().length > 0,
  ).length;

  return (
    <section
      aria-labelledby="translation-heading"
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4 lg:p-5"
    >
      <div className="space-y-1">
        <h3
          id="translation-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Translated dialogue
        </h3>
        <p className="text-sm text-muted-foreground">
          {getLanguageLabel(translation.sourceLanguage)} →{" "}
          {getLanguageLabel(translation.targetLanguage)}. The original dialogue
          is unchanged — both languages are kept.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        {translation.segments.length}{" "}
        {translation.segments.length === 1 ? "line" : "lines"}
        {translatedCount === translation.segments.length
          ? ""
          : ` · ${translatedCount} translated`}{" "}
        · revision {translation.dialogueRevision} ·{" "}
        {translation.providerModel ?? translation.providerId} · updated{" "}
        {formatRelativeTime(translation.updatedAt)}
      </p>

      <Separator />

      {translation.segments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          This dialogue has no lines to translate.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {translation.segments.map((segment) => (
            <TranslationSegmentRow
              key={segment.id}
              segment={segment}
              speakers={speakers}
            />
          ))}
        </div>
      )}
    </section>
  );
}
