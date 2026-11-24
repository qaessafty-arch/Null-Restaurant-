'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api, type Me } from '@/components/staff/api'
import { homeFor } from '@/lib/permissions'

export default function StaffHome() {
  const router = useRouter()
  useEffect(() => {
    api<{ staff: Me | null }>('GET', '/api/staff/me').then(({ staff }) => {
      if (!staff) router.replace('/staff/login')
      else router.replace(homeFor(staff.role))
    }).catch(() => router.replace('/staff/login'))
  }, [router])
  return <div className="st-boot">Loading…</div>
}
