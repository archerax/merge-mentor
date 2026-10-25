import type { ConfigFieldView } from "../server/config.types.js";

interface FieldVisibilityContext {
  /** Whether the user turned on "Show advanced settings". */
  readonly showAdvanced: boolean;
  /** Platform whose settings should be shown, when known. */
  readonly selectedPlatform: string | undefined;
  /** Whether the field has an unsaved edit, a pending clear, or a validation error. */
  readonly touched: boolean;
}

/**
 * Decides whether a setting is shown.
 *
 * Advanced settings and settings for the unselected platform are hidden until
 * advanced settings are shown. Touched fields always stay visible, and advanced
 * settings that already hold a value do too.
 */
export function isFieldVisible(field: ConfigFieldView, context: FieldVisibilityContext): boolean {
  const otherPlatform =
    field.platform !== undefined &&
    context.selectedPlatform !== undefined &&
    field.platform !== context.selectedPlatform;
  return (
    (!field.advanced && !otherPlatform) ||
    context.showAdvanced ||
    (field.advanced && field.set) ||
    context.touched
  );
}
