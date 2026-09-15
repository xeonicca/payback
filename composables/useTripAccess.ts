/** Owner-only access management. The server enforces ownership; these just call it. */
export function useTripAccess() {
  function setCollaboratorReadOnly(tripId: string, userId: string, readOnly: boolean) {
    return $fetch<{ success: boolean, readOnly: boolean }>(`/api/trips/${tripId}/collaborators/${userId}`, {
      method: 'PATCH',
      body: { readOnly },
    })
  }

  function removeCollaborator(tripId: string, userId: string) {
    return $fetch<{ success: boolean }>(`/api/trips/${tripId}/collaborators/${userId}`, {
      method: 'DELETE',
    })
  }

  function resetPublicLink(tripId: string) {
    return $fetch<{ publicJoinCode: string }>('/api/trips/reset-public-link', {
      method: 'POST',
      body: { tripId },
    })
  }

  return { setCollaboratorReadOnly, removeCollaborator, resetPublicLink }
}
