import AppAssistant from '@/components/AppAssistant'

export default function VendorPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* AI Navigation Assistant */}
      <AppAssistant />
    </>
  )
}
