import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        cinematic: {
          black: "hsl(var(--cinematic-black))",
          darker: "hsl(var(--cinematic-darker))",
          dark: "hsl(var(--cinematic-dark))",
          light: "hsl(var(--cinematic-light))",
          accent: "hsl(var(--cinematic-accent))",
        },
        badge: {
          new: "hsl(var(--badge-new))",
          hot: "hsl(var(--badge-hot))",
          free: "hsl(var(--badge-free))",
          pro: "hsl(var(--badge-pro))",
          premium: "hsl(var(--badge-premium))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "fade-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(10px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "scale-in": {
          "0%": {
            transform: "scale(0.95)",
            opacity: "0",
          },
          "100%": {
            transform: "scale(1)",
            opacity: "1",
          },
        },
        // Toast animations - entrada de baixo, saída para baixo
        "toast-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(100%) scale(0.95)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0) scale(1)",
          },
        },
        "toast-out": {
          "0%": {
            opacity: "1",
            transform: "translateY(0) scale(1)",
          },
          "100%": {
            opacity: "0",
            transform: "translateY(100%) scale(0.95)",
          },
        },
        "ping-once": {
          "0%": { transform: "scale(0.8)", opacity: "1" },
          "60%": { transform: "scale(1.2)", opacity: "0.8" },
          "100%": { transform: "scale(1.5)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "toast-in": "toast-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        "toast-out": "toast-out 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "ping-once": "ping-once 0.5s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
