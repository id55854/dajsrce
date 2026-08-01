type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;

const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

export function getRequestId(headers?: Headers): string {
  const supplied = headers?.get("x-request-id")?.trim();
  return supplied && SAFE_REQUEST_ID.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

function serializeError(error: unknown): { error_name: string; error_message: string } {
  if (error instanceof Error) {
    return { error_name: error.name, error_message: error.message };
  }
  return { error_name: "UnknownError", error_message: "Unexpected non-Error value" };
}

export function logError(
  event: string,
  error: unknown,
  context: LogContext = {}
): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event,
      ...context,
      ...serializeError(error),
    })
  );
}

export function logInfo(event: string, context: LogContext = {}): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event,
      ...context,
    })
  );
}
