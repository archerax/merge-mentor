/**
 * Which identity AI requests will be made under, for display in the status bar.
 * Never contains tokens or API keys.
 */
export type AiStatus =
  | {
      readonly kind: "copilot";
      /** GitHub login requests run as, when the SDK reports one. */
      readonly login?: string;
      readonly host?: string;
      /** How the user authenticated (e.g. `gh-cli`, `env`, `token`, `user`). */
      readonly authType?: string;
      /** Whether an explicit `MM_COPILOT_TOKEN` is configured. */
      readonly usesConfiguredToken: boolean;
    }
  | { readonly kind: "copilot-unauthenticated"; readonly message: string }
  | { readonly kind: "copilot-error"; readonly message: string }
  | {
      /** Bring-your-own-key: requests go to a custom endpoint, not Copilot. */
      readonly kind: "byok";
      /** Endpoint origin and path only; credentials and query strings are stripped. */
      readonly endpoint: string;
      readonly hasApiKey: boolean;
    }
  | { readonly kind: "other-provider"; readonly provider: string };
