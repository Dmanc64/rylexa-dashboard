-- Add image_url column to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS image_url text;

-- Drop and recreate property_metrics view to include image_url
DROP VIEW IF EXISTS property_metrics;

CREATE VIEW property_metrics AS
SELECT
  p.id AS property_id,
  p.name AS property_name,
  p.city,
  p.address,
  p.image_url,
  COUNT(u.id) AS total_units,
  COUNT(u.id) FILTER (WHERE u.status = 'Occupied') AS occupied_units,
  CASE
    WHEN COUNT(u.id) > 0
    THEN ROUND((COUNT(u.id) FILTER (WHERE u.status = 'Occupied')::numeric / COUNT(u.id)) * 100, 1)
    ELSE 0
  END AS occupancy_rate,
  COALESCE(SUM(l.rent_amount) FILTER (WHERE l.status = 'Active'), 0) AS projected_revenue
FROM properties p
LEFT JOIN units u ON u.property_id = p.id
LEFT JOIN leases l ON l.unit_id = u.id
GROUP BY p.id, p.name, p.city, p.address, p.image_url
ORDER BY p.name;

-- Create property-images storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for property images
CREATE POLICY "Authenticated users can upload property images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'property-images');

CREATE POLICY "Public read access for property images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'property-images');

CREATE POLICY "Authenticated users can update property images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'property-images');

CREATE POLICY "Authenticated users can delete property images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'property-images');
