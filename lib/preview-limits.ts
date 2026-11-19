// Best-effort protection only for one public emulator-preview instance; hosted ingress needs a WAF.
export function previewLimiter(globalMax: number, registrationMax: number) {
  let window = -1;
  let requests = 0;
  let registrations = 0;
  return (registration: boolean, now = Date.now()) => {
    const minute = Math.floor(now / 60_000);
    if (window !== minute) {
      window = minute;
      requests = 0;
      registrations = 0;
    }
    if (
      requests >= globalMax ||
      (registration && registrations >= registrationMax)
    )
      return false;
    requests++;
    if (registration) registrations++;
    return true;
  };
}
