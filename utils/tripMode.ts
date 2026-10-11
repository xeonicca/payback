interface TripModeFields {
  soloMode?: boolean
}

/** Solo UI applies only while the trip really has one member; inconsistent data falls back to the group UI. */
export function isSoloTrip(trip: TripModeFields | null | undefined, memberCount: number): boolean {
  return trip?.soloMode === true && memberCount === 1
}

/** The flag is on but extra members exist, e.g. an invite accepted before the server guard shipped. */
export function isSoloModeBroken(trip: TripModeFields | null | undefined, memberCount: number): boolean {
  return trip?.soloMode === true && memberCount > 1
}

/** Pending invitations are not a precondition — the solo-mode endpoint revokes them. */
export function canSwitchToSolo(opts: { isOwner: boolean, soloMode: boolean, memberCount: number, collaboratorCount: number }): boolean {
  return opts.isOwner && !opts.soloMode && opts.memberCount === 1 && opts.collaboratorCount <= 1
}
