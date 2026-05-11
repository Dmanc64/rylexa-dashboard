'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { Building2, User, Briefcase, CheckCircle, Loader2, AlertCircle, Phone, Users } from 'lucide-react'

type UnitOption = {
  id: string
  name: string
  property_name: string
  property_id: string
}

type PropertyOption = {
  id: string
  name: string
}

export default function ApplicationPage() {
  const [allUnits, setAllUnits] = useState<UnitOption[]>([])
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [filteredUnits, setFilteredUnits] = useState<UnitOption[]>([])
  
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  // Form State
  const [formData, setFormData] = useState({
    property_id: '',
    unit_id: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    current_address: '',
    date_of_birth: '',
    months_at_address: '',
    num_occupants: '1',
    employer: '',
    income: '',
    months_at_employer: '',
    additional_income: '',
    previous_landlord_name: '',
    previous_landlord_phone: '',
    has_pets: false,
    pet_details: ''
  })

  // 1. Fetch ONLY Available Units
  useEffect(() => {
    async function fetchData() {
      // CHANGED: Query the 'available_units' VIEW instead of raw table
      const { data } = await supabase
        .from('available_units')
        .select('*')
        .order('name')
      
      if (data) {
        setAllUnits(data)

        // Extract Unique Properties from available units
        const uniqueProps = Array.from(new Set(data.map((u: any) => u.property_id)))
            .map(id => {
                const unit = data.find((u: any) => u.property_id === id)
                return { id: id, name: unit?.property_name || 'Unknown' }
            })
        setProperties(uniqueProps)
      }
      setLoading(false)
    }
    fetchData()
  }, [])

  // 2. Handle Property Change (Filter Units)
  const handlePropertyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const propId = e.target.value
    setFormData(prev => ({ ...prev, property_id: propId, unit_id: '' })) 
    
    if (propId) {
        const unitsForProp = allUnits.filter(u => u.property_id === propId)
        setFilteredUnits(unitsForProp)
    } else {
        setFilteredUnits([])
    }
  }

  // 3. Handle Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    // Exclude property_id from insert — it's only used for UI filtering,
    // not stored in the DB (property is derived via unit_id → units.property_id)
    const { property_id: _excluded, months_at_address, months_at_employer, additional_income, num_occupants, date_of_birth, ...insertData } = formData

    // Generate the application id client-side. RLS permits anon INSERT but
    // not SELECT, so we can't rely on RETURNING to get the id back. Passing
    // our own UUID lets us hand the same id to the acknowledgment-email
    // function without needing to read back the inserted row.
    const applicationId = crypto.randomUUID()

    const { error } = await supabase.from('applications').insert({
        id: applicationId,
        ...insertData,
        income: Number(formData.income),
        date_of_birth: date_of_birth || null,
        months_at_address: months_at_address ? Number(months_at_address) : null,
        months_at_employer: months_at_employer ? Number(months_at_employer) : null,
        additional_income: additional_income ? Number(additional_income) : 0,
        num_occupants: num_occupants ? Number(num_occupants) : 1,
    })

    if (error) {
        toast.error('Error submitting application: ' + error.message)
    } else {
        setSuccess(true)

        // Fire-and-forget the acknowledgment email. The application is saved
        // either way — if email delivery fails, a PM still sees the app in
        // the admin queue and can follow up manually. Errors only go to the
        // console so the applicant's success screen isn't blocked on them.
        supabase.functions
          .invoke('notify-application-received', {
            body: { application_id: applicationId },
          })
          .then(({ error: fnError }) => {
            if (fnError) {
              console.warn('[apply] acknowledgment email failed:', fnError)
            }
          })
          .catch((err) => {
            console.warn('[apply] acknowledgment email invoke threw:', err)
          })
    }
    setSubmitting(false)
  }

  const handleChange = (e: any) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
    }))
  }

  if (success) {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="bg-white p-10 rounded-2xl shadow-xl max-w-lg text-center">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle size={40} />
                </div>
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Application Received!</h1>
                <p className="text-slate-500 mb-8">Thank you for applying. We've sent a confirmation to your inbox — our property manager will review your details and contact you shortly.</p>
                <button onClick={() => window.location.reload()} className="text-blue-600 font-bold hover:underline">Start Another Application</button>
            </div>
        </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 py-12 px-4 font-sans">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-900 p-8 text-center">
            <h1 className="text-3xl font-bold text-white tracking-tight">Rental Application</h1>
            <p className="text-blue-200 mt-2">Complete the form below to apply for your new home.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
            
            {/* Section 1: Property Info */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4 border-b pb-2">
                    <Building2 className="text-blue-600 w-5 h-5" /> Property Details
                </h3>
                <div className="grid md:grid-cols-2 gap-6">
                    
                    {/* 1. SELECT PROPERTY FIRST */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Select Property <span className="text-red-500">*</span></label>
                        <select 
                            required 
                            name="property_id"
                            className="w-full p-3 border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                            value={formData.property_id}
                            onChange={handlePropertyChange}
                        >
                            <option value="">-- Choose a Building --</option>
                            {loading ? <option>Loading...</option> : properties.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        {properties.length === 0 && !loading && (
                            <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
                                <AlertCircle size={12} /> No properties have vacancies right now.
                            </p>
                        )}
                    </div>

                    {/* 2. SELECT APARTMENT SECOND (Filtered) */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Select Apartment Applying For <span className="text-red-500">*</span></label>
                        <select 
                            required 
                            name="unit_id"
                            disabled={!formData.property_id} 
                            className="w-full p-3 border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            value={formData.unit_id}
                            onChange={handleChange}
                        >
                            <option value="">
                                {formData.property_id ? '-- Choose Apartment --' : 'Select a Property first'}
                            </option>
                            {filteredUnits.map(u => (
                                <option key={u.id} value={u.id}>
                                    Apartment {u.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Section 2: Personal Info */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4 border-b pb-2">
                    <User className="text-blue-600 w-5 h-5" /> Personal Information
                </h3>
                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">First Name</label>
                        <input required name="first_name" className="w-full p-3 border rounded-lg" onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Last Name</label>
                        <input required name="last_name" className="w-full p-3 border rounded-lg" onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Email Address</label>
                        <input required type="email" name="email" className="w-full p-3 border rounded-lg" onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Phone Number</label>
                        <input required type="tel" name="phone" className="w-full p-3 border rounded-lg" onChange={handleChange} />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-bold text-slate-700 mb-1">Current Address</label>
                        <input required name="current_address" className="w-full p-3 border rounded-lg" placeholder="Street, City, State, Zip" onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Date of Birth</label>
                        <input type="date" name="date_of_birth" className="w-full p-3 border rounded-lg" value={formData.date_of_birth} onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Months at Current Address</label>
                        <input type="number" name="months_at_address" min="0" className="w-full p-3 border rounded-lg" placeholder="e.g. 24" value={formData.months_at_address} onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">
                          <span className="flex items-center gap-1"><Users className="w-4 h-4 text-blue-600" /> Number of Occupants</span>
                        </label>
                        <input type="number" name="num_occupants" min="1" className="w-full p-3 border rounded-lg" placeholder="1" value={formData.num_occupants} onChange={handleChange} />
                    </div>
                </div>
            </div>

            {/* Section 3: Financials */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4 border-b pb-2">
                    <Briefcase className="text-blue-600 w-5 h-5" /> Employment & Income
                </h3>
                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Current Employer</label>
                        <input required name="employer" className="w-full p-3 border rounded-lg" onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Monthly Income ($)</label>
                        <input required type="number" name="income" className="w-full p-3 border rounded-lg" placeholder="e.g. 5000" onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Months at Current Employer</label>
                        <input type="number" name="months_at_employer" min="0" className="w-full p-3 border rounded-lg" placeholder="e.g. 18" value={formData.months_at_employer} onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Additional Monthly Income ($) <span className="text-slate-400 text-xs font-normal">optional</span></label>
                        <input type="number" name="additional_income" min="0" className="w-full p-3 border rounded-lg" placeholder="Side job, alimony, etc." value={formData.additional_income} onChange={handleChange} />
                    </div>
                </div>
            </div>

            {/* Section 4: References */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4 border-b pb-2">
                    <Phone className="text-blue-600 w-5 h-5" /> Previous Landlord Reference <span className="text-slate-400 text-xs font-normal ml-1">optional</span>
                </h3>
                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Landlord Name</label>
                        <input name="previous_landlord_name" className="w-full p-3 border rounded-lg" placeholder="Full name" value={formData.previous_landlord_name} onChange={handleChange} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Landlord Phone</label>
                        <input type="tel" name="previous_landlord_phone" className="w-full p-3 border rounded-lg" placeholder="(555) 123-4567" value={formData.previous_landlord_phone} onChange={handleChange} />
                    </div>
                </div>
            </div>

            {/* Pets */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="flex items-center gap-3 mb-2">
                    <input type="checkbox" name="has_pets" id="pets" className="w-5 h-5 accent-blue-600" onChange={handleChange} />
                    <label htmlFor="pets" className="font-bold text-slate-700">I have pets</label>
                </div>
                {formData.has_pets && (
                    <input 
                        name="pet_details" 
                        placeholder="Please describe (Breed, Weight, Age)" 
                        className="w-full mt-2 p-3 border rounded-lg"
                        onChange={handleChange}
                    />
                )}
            </div>

            {/* Submit Button */}
            <div className="pt-4">
                <button 
                    type="submit" 
                    disabled={submitting}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg py-4 rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
                >
                    {submitting ? <Loader2 className="animate-spin" /> : 'Submit Application'}
                </button>
                <p className="text-center text-slate-400 text-xs mt-4">By submitting, you authorize Rylexa Property Management to verify this information.</p>
            </div>

        </form>
      </div>
    </div>
  )
}