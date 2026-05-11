import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'

// 1. Pull directly from the command line (No file reading)
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SERVICE_KEY
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN

if (!SUPABASE_URL || !SERVICE_KEY || !MAPBOX_TOKEN) {
  console.error("❌ ERROR: Keys not detected in the command.")
  console.log("Please use the long command I provided in the chat.")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function geocodeAll() {
  console.log("🚀 Starting Rylexa.OS Direct Geocoding Sync...")

  const { data: properties, error } = await supabase
    .from('properties')
    .select('id, name, address, city')

  if (error) {
    console.error("❌ Supabase Error:", error.message)
    return
  }

  console.log(`📡 Linked. Processing ${properties.length} properties...`)

  for (const prop of properties) {
    const searchString = `${prop.address || prop.name}, ${prop.city}, NV`
    
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchString)}.json?access_token=${MAPBOX_TOKEN}&limit=1`
      )
      const geo = await response.json()

      if (geo.features && geo.features.length > 0) {
        const [lng, lat] = geo.features[0].center

        const { error: updateError } = await supabase
          .from('properties')
          .update({ latitude: lat, longitude: lng })
          .eq('id', prop.id)

        if (updateError) console.error(`   ❌ Failed: ${prop.name}`)
        else console.log(`   ✅ Success: ${prop.name} -> [${lat.toFixed(5)}, ${lng.toFixed(5)}]`)
      } else {
        console.warn(`   ⚠️ Location not found for: ${prop.name}`)
      }
    } catch (err) {
      console.error(`   💥 API Error: ${prop.name}`)
    }
  }

  console.log("\n🏁 Portfolio Calibrated. Refresh your Map page.")
}

geocodeAll()