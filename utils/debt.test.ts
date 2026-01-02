import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types'
import {
  calculateDebtAmount,
  calculateMemberBalance,
  calculateMemberOwedAmount,
  calculateMemberPaidAmount,
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
  })
})
