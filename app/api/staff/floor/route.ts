import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { all } from '@/lib/server/db'
import { floor } from '@/lib/server/floor'

export const dynamic = 'force-dynamic'

/** Live floor: every table with its derived status, money due, requests and next booking. */
export const GET = route(async () => {
  await requirePerm('tables.view')
  return json({
    tables: floor(),
    sections: all<{ id: number; name: string }>('SELECT id, name FROM sections ORDER BY sort, id'),
  })
})
