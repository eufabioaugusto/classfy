import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getOnboarding } from "./api";
export function OnboardingGate() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    if (
      !user ||
      loading ||
      ["/auth", "/reset-password", "/onboarding"].includes(location.pathname)
    )
      return;
    getOnboarding()
      .then((result) => {
        if (active && result.required)
          navigate("/onboarding", {
            replace: true,
            state: { returnTo: location.pathname + location.search },
          });
      })
      .catch(() => {
        /* Existing navigation remains usable during service outages. */
      });
    return () => {
      active = false;
    };
  }, [user?.id, loading, location.pathname, navigate]);
  return null;
}
