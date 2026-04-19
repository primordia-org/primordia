// components/auth-tabs/types.ts
// Shared props interface for all auth tab components.

/**
 * Props passed to every auth plugin tab component.
 *
 * @param serverProps  Whatever the plugin's getServerProps() returned.
 *                     Access plugin-specific fields as (serverProps.myField as MyType).
 * @param nextUrl      The URL to navigate to after successful authentication.
 * @param onSuccess    Call with the authenticated username to trigger redirect.
 */
export interface AuthTabProps {
  serverProps: Record<string, unknown>;
  nextUrl: string;
  onSuccess: (username: string) => void;
}
