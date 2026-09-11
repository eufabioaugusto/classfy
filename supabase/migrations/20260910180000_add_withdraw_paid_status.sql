-- Economia Classfy V1: o saque beta e pago externamente antes da baixa no ledger.
-- Isolado em uma migration propria porque novos valores de enum so podem ser
-- utilizados por migrations posteriores.
ALTER TYPE public.withdraw_status ADD VALUE IF NOT EXISTS 'paid' AFTER 'approved';
