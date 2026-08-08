export function isDemoModeAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_DEMO_MODE === "true"
  );
}
