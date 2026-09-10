
CREATE POLICY "authenticated_can_read_cycle_users_leaderboard"
ON economic_cycle_users
FOR SELECT
TO authenticated
USING (true);
;
