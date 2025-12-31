-- Add message tracking columns to studies table
ALTER TABLE public.studies 
ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS topic_deviations_count INTEGER DEFAULT 0;

-- Create function to increment message count
CREATE OR REPLACE FUNCTION public.increment_study_message_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE studies
  SET message_count = message_count + 1
  WHERE id = NEW.study_id;
  RETURN NEW;
END;
$$;

-- Create trigger to auto-increment message count
DROP TRIGGER IF EXISTS on_study_message_insert ON study_messages;
CREATE TRIGGER on_study_message_insert
  AFTER INSERT ON study_messages
  FOR EACH ROW
  EXECUTE FUNCTION increment_study_message_count();

-- Create function to get study limits based on plan
CREATE OR REPLACE FUNCTION public.get_study_limits(p_plan plan_type)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'max_studies', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 50
      ELSE 5
    END,
    'max_messages', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 200
      ELSE 30
    END,
    'max_deviations', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 20
      ELSE 3
    END
  )
$$;