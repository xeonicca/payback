import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types'
import {
  calculateDebtAmount,
  calculateMemberBalance,
  calculateMemberOwedAmount,
  calculateMemberPaidAmount,
  calculateSettlements,
} from './debt'

describe('debt calculations', () => {
  describe('calculateMemberPaidAmount', () => {
    it('should return 0 when member has not paid for any expenses', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
        } as Expense,
      ]

      expect(calculateMemberPaidAmount(expenses, 'bob')).toBe(0)
    })

    it('should calculate correct amount when member paid for one expense', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
        } as Expense,
      ]

      expect(calculateMemberPaidAmount(expenses, 'alice')).toBe(100)
    })

    it('should sum multiple expenses paid by the same member', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
        } as Expense,
        {
          id: '2',
          paidByMemberId: 'alice',
          grandTotal: 50,
          sharedWithMemberIds: ['alice', 'bob'],
        } as Expense,
        {
          id: '3',
          paidByMemberId: 'bob',
          grandTotal: 75,
          sharedWithMemberIds: ['alice', 'bob'],
        } as Expense,
      ]

      expect(calculateMemberPaidAmount(expenses, 'alice')).toBe(150)
    })
  })

  describe('calculateMemberOwedAmount', () => {
    it('should return 0 when member is not part of any expense', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
        } as Expense,
      ]

      expect(calculateMemberOwedAmount(expenses, 'charlie')).toBe(0)
    })

    it('should calculate equal split for expense without items', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
      ]

      expect(calculateMemberOwedAmount(expenses, 'alice')).toBe(50)
      expect(calculateMemberOwedAmount(expenses, 'bob')).toBe(50)
    })

    it('should handle three-way split correctly', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 150,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [],
        } as Expense,
      ]

      expect(calculateMemberOwedAmount(expenses, 'alice')).toBe(50)
      expect(calculateMemberOwedAmount(expenses, 'bob')).toBe(50)
      expect(calculateMemberOwedAmount(expenses, 'charlie')).toBe(50)
    })

    it('should calculate item-level sharing when items exist', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [
            {
              name: 'Pizza',
              price: 60,
              quantity: 1,
              sharedByMemberIds: ['alice', 'bob'], // Only Alice and Bob share pizza
            },
            {
              name: 'Drinks',
              price: 40,
              quantity: 1,
              sharedByMemberIds: [], // Empty means all expense members share
            },
          ],
        } as Expense,
      ]

      // Alice: 60/2 (pizza) + 40/3 (drinks) = 30 + 13.33 = 43.33
      expect(calculateMemberOwedAmount(expenses, 'alice')).toBeCloseTo(43.33, 2)
      // Bob: 60/2 (pizza) + 40/3 (drinks) = 30 + 13.33 = 43.33
      expect(calculateMemberOwedAmount(expenses, 'bob')).toBeCloseTo(43.33, 2)
      // Charlie: 0 (pizza) + 40/3 (drinks) = 13.33
      expect(calculateMemberOwedAmount(expenses, 'charlie')).toBeCloseTo(13.33, 2)
    })

    it('should handle quantities in item calculations', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [
            {
              name: 'Coffee',
              price: 5,
              quantity: 4, // 4 coffees at 5 each = 20
              sharedByMemberIds: ['alice', 'bob'],
            },
          ],
        } as Expense,
      ]

      // Each person: 20/2 = 10
      expect(calculateMemberOwedAmount(expenses, 'alice')).toBe(10)
      expect(calculateMemberOwedAmount(expenses, 'bob')).toBe(10)
    })
  })

  describe('calculateMemberBalance', () => {
    it('should return positive balance when member overpaid', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
      ]

      // Alice paid 100 but only owes 50, so balance is +50
      expect(calculateMemberBalance(expenses, 'alice')).toBe(50)
    })

    it('should return negative balance when member underpaid', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
      ]

      // Bob paid 0 but owes 50, so balance is -50
      expect(calculateMemberBalance(expenses, 'bob')).toBe(-50)
    })

    it('should return zero when member is balanced', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
        {
          id: '2',
          paidByMemberId: 'bob',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
      ]

      // Alice paid 100, owes 100, balance = 0
      expect(calculateMemberBalance(expenses, 'alice')).toBe(0)
      // Bob paid 100, owes 100, balance = 0
      expect(calculateMemberBalance(expenses, 'bob')).toBe(0)
    })
  })

  describe('calculateDebtAmount', () => {
    it('should return 0 when both members are balanced', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
        {
          id: '2',
          paidByMemberId: 'bob',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
      ]

      expect(calculateDebtAmount(expenses, 'alice', 'bob')).toBe(0)
    })

    it('should return positive when member1 is owed by member2', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
      ]

      // Alice balance: +50, Bob balance: -50
      // Alice is owed 50 by Bob
      expect(calculateDebtAmount(expenses, 'alice', 'bob')).toBe(50)
    })

    it('should return negative when member1 owes member2', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 100,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [],
        } as Expense,
      ]

      // Bob balance: -50, Alice balance: +50
      // Bob owes 50 to Alice
      expect(calculateDebtAmount(expenses, 'bob', 'alice')).toBe(-50)
    })

    it('should calculate minimum debt when balances are unequal', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 150,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [],
        } as Expense,
      ]

      // Alice: paid 150, owes 50, balance = +100
      // Bob: paid 0, owes 50, balance = -50
      // Charlie: paid 0, owes 50, balance = -50
      // Alice can only collect 50 from Bob (min of 100 and 50)
      expect(calculateDebtAmount(expenses, 'alice', 'bob')).toBe(50)
    })

    it('should handle complex three-person scenario', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 90,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [],
        } as Expense,
        {
          id: '2',
          paidByMemberId: 'bob',
          grandTotal: 60,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [],
        } as Expense,
      ]

      // Total: 150, each owes 50
      // Alice: paid 90, owes 50, balance = +40
      // Bob: paid 60, owes 50, balance = +10
      // Charlie: paid 0, owes 50, balance = -50

      expect(calculateDebtAmount(expenses, 'alice', 'charlie')).toBe(40)
      expect(calculateDebtAmount(expenses, 'bob', 'charlie')).toBe(10)
      expect(calculateDebtAmount(expenses, 'charlie', 'alice')).toBe(-40)
    })

    it('should return 0 when both members have positive balance', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 90,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [],
        } as Expense,
        {
          id: '2',
          paidByMemberId: 'bob',
          grandTotal: 60,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [],
        } as Expense,
      ]

      // Alice balance: +40, Bob balance: +10 — neither owes the other
      expect(calculateDebtAmount(expenses, 'alice', 'bob')).toBe(0)
      expect(calculateDebtAmount(expenses, 'bob', 'alice')).toBe(0)
    })

    it('should return 0 when both members have negative balance', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'charlie',
          grandTotal: 90,
          sharedWithMemberIds: ['alice', 'bob', 'charlie'],
          items: [],
        } as Expense,
      ]

      // Alice balance: -30, Bob balance: -30 — neither owes the other
      expect(calculateDebtAmount(expenses, 'alice', 'bob')).toBe(0)
    })

    it('should return 0 for empty expenses', () => {
      expect(calculateDebtAmount([], 'alice', 'bob')).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('calculateMemberPaidAmount returns 0 for empty expenses', () => {
      expect(calculateMemberPaidAmount([], 'alice')).toBe(0)
    })

    it('calculateMemberOwedAmount returns 0 for empty expenses', () => {
      expect(calculateMemberOwedAmount([], 'alice')).toBe(0)
    })

    it('calculateMemberBalance returns 0 for empty expenses', () => {
      expect(calculateMemberBalance([], 'alice')).toBe(0)
    })

    it('items with zero price do not contribute to owed amount', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 50,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [
            { name: 'Free item', price: 0, quantity: 1, sharedByMemberIds: ['alice', 'bob'] },
            { name: 'Paid item', price: 50, quantity: 1, sharedByMemberIds: ['alice', 'bob'] },
          ],
        } as Expense,
      ]

      expect(calculateMemberOwedAmount(expenses, 'alice')).toBe(25)
      expect(calculateMemberOwedAmount(expenses, 'bob')).toBe(25)
    })

    it('item sharedByMemberIds members not in sharedWithMemberIds are excluded', () => {
      const expenses: Expense[] = [
        {
          id: '1',
          paidByMemberId: 'alice',
          grandTotal: 60,
          sharedWithMemberIds: ['alice', 'bob'],
          items: [
            {
              name: 'Item',
              price: 60,
              quantity: 1,
              // charlie is listed but is not in sharedWithMemberIds — should be ignored
              sharedByMemberIds: ['alice', 'bob', 'charlie'],
            },
          ],
        } as Expense,
      ]

      expect(calculateMemberOwedAmount(expenses, 'alice')).toBe(30)
      expect(calculateMemberOwedAmount(expenses, 'bob')).toBe(30)
      expect(calculateMemberOwedAmount(expenses, 'charlie')).toBe(0)
    })
  })

  describe('calculateSettlements', () => {
    it('returns empty array when no members', () => {
      expect(calculateSettlements([])).toEqual([])
    })

    it('returns empty array when all balances are zero', () => {
      expect(calculateSettlements([
        { id: 'alice', balance: 0 },
        { id: 'bob', balance: 0 },
      ])).toEqual([])
    })

    it('returns empty array when all balances are within rounding threshold', () => {
      expect(calculateSettlements([
        { id: 'alice', balance: 0.005 },
        { id: 'bob', balance: -0.005 },
      ])).toEqual([])
    })

    it('single debtor pays single creditor', () => {
      const result = calculateSettlements([
        { id: 'alice', balance: 50 },
        { id: 'bob', balance: -50 },
      ])
      expect(result).toEqual([{ fromId: 'bob', toId: 'alice', amount: 50 }])
    })

    it('two debtors each pay a single creditor cleanly', () => {
      const result = calculateSettlements([
        { id: 'alice', balance: 100 },
        { id: 'bob', balance: -60 },
        { id: 'charlie', balance: -40 },
      ])
      expect(result).toHaveLength(2)
      expect(result).toContainEqual({ fromId: 'bob', toId: 'alice', amount: 60 })
      expect(result).toContainEqual({ fromId: 'charlie', toId: 'alice', amount: 40 })
    })

    it('members with equal debt both pay the same creditor cleanly', () => {
      // alice and bob each owe 30 to charlie
      const result = calculateSettlements([
        { id: 'alice', balance: -30 },
        { id: 'bob', balance: -30 },
        { id: 'charlie', balance: 60 },
      ])
      expect(result).toHaveLength(2)
      expect(result.every(s => s.toId === 'charlie')).toBe(true)
      expect(result.find(s => s.fromId === 'alice')?.amount).toBe(30)
      expect(result.find(s => s.fromId === 'bob')?.amount).toBe(30)
    })

    it('splits land on the largest debtor when perfect partition is impossible', () => {
      // debtors: A(-30), B(-30), C(-40), D(-50) — no subset sums to either creditor amount
      // creditors: X(+42), Y(+108)
      // smallest-first: A and B fill up cleanly; split falls on D (largest)
      const result = calculateSettlements([
        { id: 'A', balance: -30 },
        { id: 'B', balance: -30 },
        { id: 'C', balance: -40 },
        { id: 'D', balance: -50 },
        { id: 'X', balance: 42 },
        { id: 'Y', balance: 108 },
      ])

      const aPayments = result.filter(s => s.fromId === 'A')
      const bPayments = result.filter(s => s.fromId === 'B')
      const dPayments = result.filter(s => s.fromId === 'D')

      // A and B (equal, smallest) each make exactly one payment
      expect(aPayments).toHaveLength(1)
      expect(bPayments).toHaveLength(1)

      // D (largest) absorbs the unavoidable split
      expect(dPayments).toHaveLength(2)
      expect(dPayments.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(50)

      // totals balance out
      const totalPaid = result.reduce((sum, s) => sum + s.amount, 0)
      expect(totalPaid).toBeCloseTo(150)
    })

    it('total amount paid in settlements equals total debt', () => {
      const members = [
        { id: 'alice', balance: 70 },
        { id: 'bob', balance: 30 },
        { id: 'charlie', balance: -40 },
        { id: 'dave', balance: -60 },
      ]
      const result = calculateSettlements(members)
      const totalPaid = result.reduce((sum, s) => sum + s.amount, 0)
      expect(totalPaid).toBeCloseTo(100)
    })

    it('each debtor pays the full amount they owe across all their settlements', () => {
      const members = [
        { id: 'alice', balance: 150 },
        { id: 'bob', balance: -80 },
        { id: 'charlie', balance: -70 },
      ]
      const result = calculateSettlements(members)

      const bobTotal = result.filter(s => s.fromId === 'bob').reduce((sum, s) => sum + s.amount, 0)
      const charlieTotal = result.filter(s => s.fromId === 'charlie').reduce((sum, s) => sum + s.amount, 0)

      expect(bobTotal).toBeCloseTo(80)
      expect(charlieTotal).toBeCloseTo(70)
    })
  })
})
