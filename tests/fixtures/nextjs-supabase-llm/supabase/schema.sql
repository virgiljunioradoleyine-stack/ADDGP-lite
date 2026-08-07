CREATE TABLE patients (
  id uuid PRIMARY KEY,
  full_name text NOT NULL,
  ghana_card_number text NOT NULL,
  phone text,
  email text,
  diagnosis text,
  religion text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE triage_decisions (
  id uuid PRIMARY KEY,
  patient_id uuid REFERENCES patients(id),
  risk_score numeric,
  auto_referral boolean
);
