export function useTripBalances(tripId: string) {
  const { enabledExpenses: allEnabledExpenses } = useTripExpenses(tripId, 0)

  // Calculate how much each member has actually paid
  function getMemberPaidAmount(memberId: string) {
    if (!allEnabledExpenses.value)
      return 0

    return allEnabledExpenses.value
      .filter(expense => expense.paidByMemberId === memberId)
      .reduce((total, expense) => total + expense.grandTotal, 0)
  }

  // Calculate how much a member owes (considering item-level sharing)
  function getMemberOwedAmount(memberId: string) {
    if (!allEnabledExpenses.value)
      return 0

    let totalOwed = 0

    allEnabledExpenses.value.forEach((expense) => {
      // If expense has items, calculate based on item-level sharing
      if (expense.items && expense.items.length > 0) {
        // First, calculate total of all items
        const itemsTotal = expense.items.reduce(
          (sum, item) => sum + (item.price * (item.quantity || 1)),
          0,
        )

        // Only use item-level sharing if items have valid prices
        if (itemsTotal > 0) {
          // Calculate this member's share of items
          let memberItemsTotal = 0
          expense.items.forEach((item) => {
            let sharingMembers: string[] = []

            // If item has no specific sharedByMemberIds, all expense members share it
            if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
              sharingMembers = expense.sharedWithMemberIds
            }
            else {
              // Only include members who are both in item sharing AND main expense sharing
              sharingMembers = item.sharedByMemberIds.filter(id =>
                expense.sharedWithMemberIds.includes(id),
              )
            }

            // Skip if no members are sharing this item or if this member isn't sharing
            if (sharingMembers.length === 0 || !sharingMembers.includes(memberId)) {
              return
            }

            // Calculate this member's share of this item
            const itemTotal = item.price * (item.quantity || 1)
            const sharePerMember = itemTotal / sharingMembers.length
            memberItemsTotal += sharePerMember
          })

          // Proportionally distribute the grandTotal based on this member's item share
          // This ensures taxes, fees, tips, etc. are distributed proportionally
          const memberProportion = memberItemsTotal / itemsTotal
          totalOwed += expense.grandTotal * memberProportion
        }
        else {
          // Items exist but have no prices - fall back to expense-level sharing
          if (expense.sharedWithMemberIds.includes(memberId)) {
            const sharePerMember = expense.grandTotal / expense.sharedWithMemberIds.length
            totalOwed += sharePerMember
          }
        }
      }
      else {
        // If no items, use expense-level sharing
        if (expense.sharedWithMemberIds.includes(memberId)) {
          const sharePerMember = expense.grandTotal / expense.sharedWithMemberIds.length
          totalOwed += sharePerMember
        }
      }
    })

    return totalOwed
  }

  // Calculate member balance (paid - owed)
  function getMemberBalance(memberId: string) {
    const paid = getMemberPaidAmount(memberId)
    const owed = getMemberOwedAmount(memberId)

    return paid - owed
  }

  // Helper function to calculate debt amount between two members
  function getDebtAmount(member1Id: string, member2Id: string) {
    const member1Balance = getMemberBalance(member1Id)
    const member2Balance = getMemberBalance(member2Id)

    // If member1 has positive balance and member2 has negative balance,
    // member1 is owed money by member2
    if (member1Balance > 0 && member2Balance < 0) {
      return Math.min(member1Balance, Math.abs(member2Balance))
    }

    // If member1 has negative balance and member2 has positive balance,
    // member1 owes money to member2
    if (member1Balance < 0 && member2Balance > 0) {
      return -Math.min(Math.abs(member1Balance), member2Balance)
    }

    return 0
  }

  return {
    getMemberPaidAmount,
    getMemberOwedAmount,
    getMemberBalance,
    getDebtAmount,
  }
}
