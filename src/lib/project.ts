/**
 * Part 1 has no project persistence. Workspace routes render for any project
 * id, and the displayed name is derived from the id itself so the shell has
 * something honest to show — it is a placeholder, not stored metadata.
 */
export function deriveProjectName(projectId: string): string {
  const words = decodeURIComponent(projectId)
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "Untitled project";
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
