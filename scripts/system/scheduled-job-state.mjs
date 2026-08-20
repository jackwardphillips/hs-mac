export function reconcileJobStatus(previousStatus, observedStatus, recoveryEligible = true) {
  if (previousStatus !== "healthy" && observedStatus === "healthy" && !recoveryEligible) {
    return previousStatus;
  }
  return observedStatus;
}
