import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    // Fetch all published listings with unit + property data
    const { data: listings, error } = await supabase
      .from('unit_listings')
      .select(`
        id, title, description, rent_amount, deposit_amount, lease_terms,
        amenities, pet_policy, photos, virtual_tour_url,
        contact_email, contact_phone, published_at,
        units!inner (
          id, name, bedroom_count, bathrooms, sqft, availability_date,
          properties!inner ( id, name, address, city, state, zip )
        )
      `)
      .eq('status', 'published')
      .order('published_at', { ascending: false })

    if (error) throw error

    // Group listings by property
    const propertiesMap = new Map<string, {
      property: any
      units: any[]
    }>()

    for (const listing of (listings || [])) {
      const unit = listing.units as any
      const property = unit.properties
      const propertyId = property.id

      if (!propertiesMap.has(propertyId)) {
        propertiesMap.set(propertyId, { property, units: [] })
      }

      // Generate signed URLs for photos (1hr expiry)
      const photoUrls: string[] = []
      for (const path of (listing.photos || []).slice(0, 10)) {
        const { data: signed } = await supabase.storage
          .from('listings')
          .createSignedUrl(path, 3600)
        if (signed?.signedUrl) photoUrls.push(signed.signedUrl)
      }

      propertiesMap.get(propertyId)!.units.push({
        ...listing,
        unit,
        photoUrls,
      })
    }

    // Build MITS 4.0 XML
    const now = new Date().toISOString()
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
    xml += `<PhysicalProperty xmlns="http://www.mfrm.org/mits/v4.0">\n`

    for (const [propertyId, { property, units }] of propertiesMap) {
      xml += `  <Property>\n`
      xml += `    <PropertyID>\n`
      xml += `      <Identification IDValue="${escapeXml(propertyId)}" IDType="propertyId" />\n`
      xml += `      <MarketingName>${escapeXml(property.name || '')}</MarketingName>\n`
      xml += `      <Address>\n`
      xml += `        <AddressLine1>${escapeXml(property.address || '')}</AddressLine1>\n`
      xml += `        <City>${escapeXml(property.city || '')}</City>\n`
      xml += `        <State>${escapeXml(property.state || '')}</State>\n`
      xml += `        <PostalCode>${escapeXml(property.zip || '')}</PostalCode>\n`
      xml += `        <Country>US</Country>\n`
      xml += `      </Address>\n`
      xml += `    </PropertyID>\n`

      for (const listing of units) {
        const unit = listing.unit
        xml += `    <ILS_Unit>\n`
        xml += `      <Units>\n`
        xml += `        <Unit>\n`
        xml += `          <Identification IDValue="${escapeXml(unit.id)}" IDType="unitId" />\n`
        xml += `          <MarketingName>${escapeXml(listing.title)}</MarketingName>\n`
        xml += `          <UnitNumber>${escapeXml(unit.name || '')}</UnitNumber>\n`

        if (unit.bedroom_count != null) {
          xml += `          <UnitBedrooms>${unit.bedroom_count}</UnitBedrooms>\n`
        }
        if (unit.bathrooms != null) {
          xml += `          <UnitBathrooms>${unit.bathrooms}</UnitBathrooms>\n`
        }
        if (unit.sqft != null) {
          xml += `          <MinSquareFeet>${unit.sqft}</MinSquareFeet>\n`
          xml += `          <MaxSquareFeet>${unit.sqft}</MaxSquareFeet>\n`
        }

        xml += `          <UnitRent>${listing.rent_amount}</UnitRent>\n`

        if (listing.deposit_amount) {
          xml += `          <DepositAmount>${listing.deposit_amount}</DepositAmount>\n`
        }

        xml += `        </Unit>\n`
        xml += `      </Units>\n`

      // Description
      if (listing.description) {
        xml += `      <Description>${escapeXml(listing.description)}</Description>\n`
      }

      // Amenities
      for (const amenity of (listing.amenities || [])) {
        xml += `      <Amenity>\n`
        xml += `        <AmenityType>${escapeXml(amenity)}</AmenityType>\n`
        xml += `      </Amenity>\n`
      }

      // Pet policy
      if (listing.pet_policy) {
        const petMap: Record<string, string> = {
          allowed: 'Allowed',
          not_allowed: 'Not Allowed',
          case_by_case: 'Conditional',
        }
        xml += `      <PetPolicy>${petMap[listing.pet_policy] || 'Conditional'}</PetPolicy>\n`
      }

      // Lease terms
      for (const term of (listing.lease_terms || [])) {
        xml += `      <LeaseTerm>${escapeXml(term)}</LeaseTerm>\n`
      }

      // Availability
      xml += `      <Availability>\n`
      if (unit.availability_date) {
        xml += `        <VacateDate>${unit.availability_date}</VacateDate>\n`
      } else {
        xml += `        <VacateDate>Available Now</VacateDate>\n`
      }
      xml += `      </Availability>\n`

      // Photos
      for (let i = 0; i < listing.photoUrls.length; i++) {
        xml += `      <Photo>\n`
        xml += `        <PhotoURL>${escapeXml(listing.photoUrls[i])}</PhotoURL>\n`
        xml += `        <PhotoRank>${i + 1}</PhotoRank>\n`
        xml += `      </Photo>\n`
      }

      // Virtual tour
      if (listing.virtual_tour_url) {
        xml += `      <VirtualTour>${escapeXml(listing.virtual_tour_url)}</VirtualTour>\n`
      }

      // Contact
      if (listing.contact_email || listing.contact_phone) {
        xml += `      <Contact>\n`
        if (listing.contact_email) {
          xml += `        <Email>${escapeXml(listing.contact_email)}</Email>\n`
        }
        if (listing.contact_phone) {
          xml += `        <Phone>${escapeXml(listing.contact_phone)}</Phone>\n`
        }
        xml += `      </Contact>\n`
      }

        xml += `    </ILS_Unit>\n`
      }

      xml += `  </Property>\n`
    }

    xml += `</PhysicalProperty>\n`

    return new Response(xml, {
      headers: {
        ...cors,
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=900',
      },
    })
  } catch (err) {
    console.error('listing-feed error:', err)
    return new Response(
      `<?xml version="1.0"?><error>${(err as Error).message}</error>`,
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/xml' },
      }
    )
  }
})
