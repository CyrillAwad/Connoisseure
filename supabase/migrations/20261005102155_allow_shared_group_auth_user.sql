DO $$
DECLARE
  group_user_id uuid;
BEGIN
  SELECT id
    INTO group_user_id
    FROM auth.users
   WHERE lower(email) = lower('connoisseur.pro@gmx.de');

  IF group_user_id IS NULL THEN
    RAISE EXCEPTION 'The shared group Auth user connoisseur.pro@gmx.de does not exist';
  END IF;

  INSERT INTO private.group_access (user_id)
  VALUES (group_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;
