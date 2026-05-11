// src/app/page.tsx
import { redirect } from 'next/navigation'

export default function EntryPoint() {
  // Automatically send everyone to the login page
  redirect('/login')
}