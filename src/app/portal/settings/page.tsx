'use client'

import { useState, useEffect } from 'react'
import {
  Bell, Phone, Mail, Loader2, Settings, User, Home as HomeIcon, Calendar
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useMyPreferences,
  useUpdatePreference,
  isPreferenceEnabled,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationCategory,
} from '@/hooks/useNotificationPreferences'
import { toast } from 'sonner'

type ProfileData = {
  name: string
  email: string
  unit: string
  property: string
  leaseEnd: string | null
}

export default function NotificationSettingsPage() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()
  const { data: preferences = [], isLoading: prefsLoading } = useMyPreferences()
  const updatePref = useUpdatePreference()
  const [phone, setPhone] = useState('')
  const [originalPhone, setOriginalPhone] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [profileData, setProfileData] = useState<ProfileData | null>(null)

  // Fetch tenant phone + profile data
  useEffect(() => {
    async function fetchData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch lease with tenant, unit, property info
      const { data: lease } = await supabase
        .from('leases')
        .select(`
          end_date,
          tenants ( first_name, last_name, phone, email ),
          units ( name, properties ( name ) )
        `)
        .eq('user_id', user.id)
        .eq('status', 'Active')
        .maybeSingle()

      if (lease) {
        const tenant = lease.tenants as any
        const unit = lease.units as any

        if (tenant?.phone) {
          setPhone(tenant.phone)
          setOriginalPhone(tenant.phone)
        }

        setProfileData({
          name: `${tenant?.first_name || ''} ${tenant?.last_name || ''}`.trim() || 'Resident',
          email: tenant?.email || user.email || '',
          unit: unit?.name || 'N/A',
          property: unit?.properties?.name || 'N/A',
          leaseEnd: lease.end_date || null,
        })
      }
    }
    fetchData()
  }, [])

  const handlePhoneSave = async () => {
    setSavingPhone(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Not authenticated'); setSavingPhone(false); return }

    const { error } = await supabase
      .from('tenants')
      .update({ phone })
      .eq('user_id', user.id)

    setSavingPhone(false)
    if (error) {
      toast.error('Failed to update phone: ' + error.message)
    } else {
      setOriginalPhone(phone)
      toast.success('Phone number updated')
    }
  }

  const handleToggle = (channel: NotificationChannel, category: NotificationCategory) => {
    const currentlyEnabled = isPreferenceEnabled(preferences, channel, category)
    updatePref.mutate(
      { channel, category, enabled: !currentlyEnabled },
      {
        onError: (err: any) => toast.error(err.message || 'Failed to update preference'),
      }
    )
  }

  const smsEnabled = isEnabled('sms_notifications')
  const loading = flagsLoading || prefsLoading

  // Filter channels based on feature flags
  const activeChannels = NOTIFICATION_CHANNELS.filter(
    ch => ch.key !== 'sms' || smsEnabled
  )

  return (
    <div className="p-4 md:p-10 animate-in fade-in">
      <div className="max-w-2xl mx-auto">

        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">Settings</h1>
          <p className="text-slate-500 font-medium text-sm">
            Manage your profile and notification preferences
          </p>
        </div>

        {/* PROFILE INFO */}
        {profileData && (
          <div className="bg-white rounded-[2rem] border border-slate-200 p-6 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <User size={16} className="text-blue-600" />
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                Your Profile
              </h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Name</span>
                <span className="text-sm font-bold text-slate-900">{profileData.name}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Email</span>
                <span className="text-sm font-bold text-slate-900">{profileData.email}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Unit</span>
                <span className="text-sm font-bold text-slate-900">{profileData.unit}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Property</span>
                <span className="text-sm font-bold text-slate-900">{profileData.property}</span>
              </div>
              {profileData.leaseEnd && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Lease Until</span>
                  <span className="text-sm font-bold text-slate-900">
                    {new Date(profileData.leaseEnd + 'T00:00:00').toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-4">
              Contact your property manager to update your personal information.
            </p>
          </div>
        )}

        {/* PHONE NUMBER */}
        {smsEnabled && (
          <div className="bg-white rounded-[2rem] border border-slate-200 p-6 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Phone size={16} className="text-emerald-600" />
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                Phone Number
              </h3>
            </div>
            <div className="flex gap-3">
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(775) 555-1234"
                className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              />
              <button
                onClick={handlePhoneSave}
                disabled={savingPhone || phone === originalPhone}
                className="px-5 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingPhone ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              Used for SMS notifications. Message & data rates may apply. Reply STOP to opt out.
            </p>
          </div>
        )}

        {/* NOTIFICATION PREFERENCES GRID */}
        <div className="bg-white rounded-[2rem] border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Bell size={16} className="text-emerald-600" />
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
              Notification Preferences
            </h3>
          </div>

          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="animate-spin text-emerald-500" size={24} />
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header Row */}
              <div className="flex items-center gap-4 pb-3 border-b border-slate-100">
                <div className="flex-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Category</p>
                </div>
                {activeChannels.map(ch => (
                  <div key={ch.key} className="w-16 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {ch.key === 'email' ? <Mail size={12} className="text-slate-400" /> : <Phone size={12} className="text-slate-400" />}
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{ch.label}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Category Rows */}
              {NOTIFICATION_CATEGORIES.map(cat => (
                <div key={cat.key} className="flex items-center gap-4 py-4 border-b border-slate-50 last:border-0">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-900">{cat.label}</p>
                    <p className="text-[10px] text-slate-400">{cat.description}</p>
                  </div>
                  {activeChannels.map(ch => {
                    const enabled = isPreferenceEnabled(preferences, ch.key, cat.key)
                    const toggling = updatePref.isPending
                    return (
                      <div key={ch.key} className="w-16 flex justify-center">
                        <button
                          onClick={() => handleToggle(ch.key, cat.key)}
                          disabled={toggling}
                          className={`w-11 h-6 rounded-full transition-all duration-200 relative ${
                            enabled ? 'bg-emerald-500' : 'bg-slate-200'
                          } ${toggling ? 'opacity-50' : ''}`}
                        >
                          <span
                            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${
                              enabled ? 'left-[22px]' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COMPLIANCE */}
        {smsEnabled && (
          <div className="mt-4 px-4">
            <p className="text-[10px] text-slate-400 text-center">
              By enabling SMS notifications, you agree to receive text messages from Rylexa.
              Message & data rates may apply. Text STOP to unsubscribe at any time.
              Frequency varies. See our{' '}
              <span className="underline">Privacy Policy</span> for details.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
