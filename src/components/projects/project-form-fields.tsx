"use client";

import { useId } from "react";

import { LANGUAGES } from "@/lib/languages";
import { PROJECT_NAME_MAX_LENGTH } from "@/types/project";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ProjectNameField({
  value,
  onChange,
  error,
  autoFocus,
  label = "Project name",
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        autoFocus={autoFocus}
        maxLength={PROJECT_NAME_MAX_LENGTH}
        placeholder="Travel documentary"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LanguageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select a language" />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {language.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
