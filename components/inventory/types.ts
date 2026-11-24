export type Ingredient = {
  id: number; name: string; sku: string | null; category: string; unit: string; stock: number; minLevel: number; unitCost: number; value: number
  supplierId: number | null; supplier: string | null; trackExpiry: boolean; active: boolean; low: boolean; out: boolean; usedBy: number
  nextExpiry: string | null; expiringQty: number
}
export type Supplier = { id: number; name: string; contact: string; phone: string; email: string; notes: string; active: boolean; ingredients: number }
export type Movement = {
  id: number; ingredientId: number; ingredient: string; unit: string; change: number; balance: number; kind: string; reason: string; value: number
  order: string | null; po: string | null; by: string | null; at: string
}
export type PO = {
  id: number; label: string; supplierId: number | null; supplier: string | null; status: 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled'
  expectedOn: string | null; notes: string; createdAt: string; receivedAt: string | null; total: number
  lines: Array<{ id: number; ingredientId: number; ingredient: string; unit: string; qty: number; unitCost: number; received: number; total: number }>
}
export type RecipeLine = { optionId: number | null; option: string | null; ingredientId: number; ingredient: string; unit: string; qty: number; cost: number }

export const qty = (n: number, unit: string) => `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`
export const KIND_LABEL: Record<string, string> = {
  sale: 'Used by order', sale_reversal: 'Returned (cancelled)', purchase: 'Received', adjustment: 'Adjustment', waste: 'Waste', count: 'Stock count', opening: 'Opening stock',
}
