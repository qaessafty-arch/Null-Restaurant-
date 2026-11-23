export type PosConfig = {
  baseCurrency: string
  currencies: string[]
  rates: Record<string, number>
  ratesUpdatedAt: string | null
  methods: Array<{ id: string; label: string; kind: 'cash' | 'card' | 'transfer' | 'online' | 'other' }>
  maxCashierDiscountPercent: number
  loyalty: { enabled: boolean; pointValue: number; minRedeem: number; maxRedeemPercent: number }
  deliveryEnabled: boolean
  taxPercent: number
  servicePercent: number
  tables: Array<{ id: number; number: string; location: string }>
}

export type BillOrder = {
  id: string; number: number; label: string; type: string; tableNumber: string; status: string; customerName: string
  subtotal: number; discount: number; discountReason: string; tax: number; serviceCharge: number; total: number
  paid: number; due: number; paymentStatus: string; createdAt: string
  loyaltyDiscount: number; loyaltyPoints: number; pointsEarned: number
  customer: { id: number; name: string; tier: string; points: number; preferences: string } | null
  items: Array<{ name: string; quantity: number; lineTotal: number; options: string }>
}

export type Bill = {
  table?: { id: number; number: string; location: string }
  billRequestedAt?: string | null
  orders: BillOrder[]
  subtotal: number; discount: number; loyaltyDiscount: number; tax: number; serviceCharge: number; total: number; paid: number; due: number
}

export type OpenBill = {
  key: string; kind: 'table' | 'order'; tableId: number | null; label: string; orders: number
  total: number; due: number; billRequestedAt: string | null; since: string | null
}

export type Payment = {
  id: string; kind: 'payment' | 'refund'; method: string; currency: string; amount: number; rate: number; baseAmount: number
  tendered: number | null; change: number; reference: string; note: string; status: 'completed' | 'voided'; voidReason: string
  cashier: string | null; createdAt: string; refunded: number
  orders: Array<{ id: string; label: string; amount: number }>
}

export type Receipt = Bill & {
  restaurant: { name: string; header: string; footer: string; currency: string }
  reprint: boolean; printedAt: string; cashier: string; tableNumber: string; payments: Payment[]
}
