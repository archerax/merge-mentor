import { Alert } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

interface RunErrorAlertProps {
  readonly title: string;
  readonly message: string;
}

/** Matches the "Configuration error for MM_X: ..." messages the server returns. */
const CONFIG_ERROR = /^configuration error\b/i;

/**
 * Error banner for a failed run. It scrolls itself into view, because it
 * renders below the form and would otherwise be off-screen on a short window,
 * and links to the configuration page when the cause is a missing setting.
 */
export function RunErrorAlert({ title, message }: RunErrorAlertProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [message]);

  return (
    // scrollMarginBottom keeps the alert clear of the fixed AI status bar.
    <Alert ref={ref} title={title} color="red" style={{ scrollMarginBottom: 80 }}>
      {message}
      {CONFIG_ERROR.test(message) && (
        <>
          {" "}
          Check the <Link to="/config">configuration</Link>.
        </>
      )}
    </Alert>
  );
}
