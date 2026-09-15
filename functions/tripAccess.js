/**
 * Mirrors the Firestore rule for expense update/delete, for callables that
 * modify expenses with the Admin SDK (which bypasses rules).
 */
function canModifyExpense({ uid, trip, collaborator, expense }) {
  if (!uid || !trip || !collaborator || !expense)
    return false
  if (!(trip.collaboratorUserIds || []).includes(uid))
    return false
  if (collaborator.readOnly === true)
    return false
  return collaborator.role === 'owner'
    || collaborator.role === 'editor'
    || expense.createdByUserId === uid
}

module.exports = { canModifyExpense }
