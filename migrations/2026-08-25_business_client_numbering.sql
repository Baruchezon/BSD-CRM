BEGIN;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_number_running integer;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_number text;
CREATE SEQUENCE IF NOT EXISTS business_number_seq START WITH 1001;

CREATE OR REPLACE FUNCTION trg_assign_business_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  il_ts timestamptz;
  yy text; mm text;
BEGIN
  IF NEW.business_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  il_ts := COALESCE(NEW.created_at, now());
  yy := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'YY');
  mm := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'MM');
  NEW.business_number_running := nextval('business_number_seq');
  NEW.business_number := 'BSD-B-' || yy || mm || '-' || NEW.business_number_running;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_businesses_business_number ON businesses;
CREATE TRIGGER trg_businesses_business_number BEFORE INSERT ON businesses FOR EACH ROW EXECUTE FUNCTION trg_assign_business_number();

CREATE OR REPLACE FUNCTION trg_protect_business_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.business_number IS NOT NULL AND NEW.business_number IS DISTINCT FROM OLD.business_number THEN
    NEW.business_number := OLD.business_number;
  END IF;
  IF OLD.business_number_running IS NOT NULL AND NEW.business_number_running IS DISTINCT FROM OLD.business_number_running THEN
    NEW.business_number_running := OLD.business_number_running;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_businesses_protect_business_number ON businesses;
CREATE TRIGGER trg_businesses_protect_business_number BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION trg_protect_business_number();
UPDATE businesses SET business_number_running = 1, business_number = 'BSD-B-2607-1001' WHERE id = '50567a42-bf62-43f7-9fca-070c8862fa77';
UPDATE businesses SET business_number_running = 2, business_number = 'BSD-B-2607-1002' WHERE id = '779a9f13-0248-4a9b-b6d2-897f813b44f3';
UPDATE businesses SET business_number_running = 3, business_number = 'BSD-B-2607-1003' WHERE id = '02047fc5-6849-4e97-8790-6d172502f58a';
UPDATE businesses SET business_number_running = 4, business_number = 'BSD-B-2607-1004' WHERE id = '89ae91b2-f67d-43fb-9915-bfdb6f2e22e1';
UPDATE businesses SET business_number_running = 5, business_number = 'BSD-B-2607-1005' WHERE id = 'e43fde51-dcc1-41b8-a134-4e72ec256342';
UPDATE businesses SET business_number_running = 6, business_number = 'BSD-B-2607-1006' WHERE id = 'c8e9c4c3-4869-47ed-b361-c1035cdf673d';
UPDATE businesses SET business_number_running = 7, business_number = 'BSD-B-2607-1007' WHERE id = '3ae43137-a078-4cbc-a366-43293f8b318b';
UPDATE businesses SET business_number_running = 8, business_number = 'BSD-B-2607-1008' WHERE id = '7d4ac0cc-fac6-4f9c-b592-2b95a26711d7';
UPDATE businesses SET business_number_running = 9, business_number = 'BSD-B-2607-1009' WHERE id = 'a112fb2d-3a47-499f-acca-fe3ede9d3d2b';
UPDATE businesses SET business_number_running = 10, business_number = 'BSD-B-2607-1010' WHERE id = '69ea1bae-51e4-4473-9013-516ca7f94055';
UPDATE businesses SET business_number_running = 11, business_number = 'BSD-B-2607-1011' WHERE id = 'f3647d1d-f49a-42d6-b02a-019c672f9a9c';
UPDATE businesses SET business_number_running = 12, business_number = 'BSD-B-2607-1012' WHERE id = 'ef0cae1a-1585-4edf-b1d0-2b724d82a730';
UPDATE businesses SET business_number_running = 13, business_number = 'BSD-B-2607-1013' WHERE id = 'e98fe609-8366-46cd-8292-da38368728c3';
UPDATE businesses SET business_number_running = 14, business_number = 'BSD-B-2607-1014' WHERE id = 'dad6884d-40cb-4e90-9496-372366073827';
UPDATE businesses SET business_number_running = 15, business_number = 'BSD-B-2607-1015' WHERE id = '9d9d6033-7a2d-4c73-8676-8e3bcc91d668';
UPDATE businesses SET business_number_running = 16, business_number = 'BSD-B-2607-1016' WHERE id = '20d6ef63-689d-449c-a972-109f595aaf61';
UPDATE businesses SET business_number_running = 17, business_number = 'BSD-B-2607-1017' WHERE id = '1c60ce80-6334-47e6-8342-342a2707e50c';
UPDATE businesses SET business_number_running = 18, business_number = 'BSD-B-2607-1018' WHERE id = 'a4500aff-558a-4023-999b-cad7214d2a69';
UPDATE businesses SET business_number_running = 19, business_number = 'BSD-B-2607-1019' WHERE id = '9c9d99d8-3a0c-4d2a-9f65-7d0fe83959e6';
UPDATE businesses SET business_number_running = 20, business_number = 'BSD-B-2608-1020' WHERE id = '791bc37a-40cb-494c-a2be-f300064b0172';
UPDATE businesses SET business_number_running = 21, business_number = 'BSD-B-2608-1021' WHERE id = '587d4894-3fc1-451b-880f-b335dc44760d';
UPDATE businesses SET business_number_running = 22, business_number = 'BSD-B-2608-1022' WHERE id = '834d651e-61e3-47a2-b5a2-06e4314a4fd3';
UPDATE businesses SET business_number_running = 23, business_number = 'BSD-B-2608-1023' WHERE id = '4f1d94be-72e9-4fa4-98a8-18132459c7b8';
UPDATE businesses SET business_number_running = 24, business_number = 'BSD-B-2608-1024' WHERE id = 'd54d76c5-dfec-4693-b2da-43230915b23e';
UPDATE businesses SET business_number_running = 25, business_number = 'BSD-B-2608-1025' WHERE id = '039161a4-4887-4f65-8f54-3a5aa1a61074';
UPDATE businesses SET business_number_running = 26, business_number = 'BSD-B-2608-1026' WHERE id = '1ab72082-556f-4039-ba54-79bbd707aa07';
UPDATE businesses SET business_number_running = 27, business_number = 'BSD-B-2608-1027' WHERE id = 'baf5d597-8858-42a3-b867-b78ce2d956a3';
UPDATE businesses SET business_number_running = 28, business_number = 'BSD-B-2608-1028' WHERE id = '96204a00-9f26-4985-92ec-8d81cecc08c7';
UPDATE businesses SET business_number_running = 29, business_number = 'BSD-B-2608-1029' WHERE id = 'ec379ad4-441a-4344-85f4-822cdbb3fbf6';
SELECT setval('business_number_seq', 29+1000, true);
ALTER TABLE businesses ADD CONSTRAINT business_number_unique UNIQUE (business_number);
ALTER TABLE businesses ADD CONSTRAINT business_number_running_unique UNIQUE (business_number_running);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_number_running integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_number text;
CREATE SEQUENCE IF NOT EXISTS client_number_seq START WITH 1001;

CREATE OR REPLACE FUNCTION trg_assign_client_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  il_ts timestamptz;
  yy text; mm text;
BEGIN
  IF NEW.type NOT IN ('buyer','partner') THEN
    RETURN NEW;
  END IF;
  IF NEW.client_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  il_ts := COALESCE(NEW.created_at, now());
  yy := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'YY');
  mm := to_char(il_ts AT TIME ZONE 'Asia/Jerusalem', 'MM');
  NEW.client_number_running := nextval('client_number_seq');
  NEW.client_number := 'BSD-C-' || yy || mm || '-' || NEW.client_number_running;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_client_number ON leads;
CREATE TRIGGER trg_leads_client_number BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION trg_assign_client_number();

CREATE OR REPLACE FUNCTION trg_protect_client_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.client_number IS NOT NULL AND NEW.client_number IS DISTINCT FROM OLD.client_number THEN
    NEW.client_number := OLD.client_number;
  END IF;
  IF OLD.client_number_running IS NOT NULL AND NEW.client_number_running IS DISTINCT FROM OLD.client_number_running THEN
    NEW.client_number_running := OLD.client_number_running;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_protect_client_number ON leads;
CREATE TRIGGER trg_leads_protect_client_number BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION trg_protect_client_number();
UPDATE leads SET client_number_running = 1, client_number = 'BSD-C-2607-1001' WHERE id = '0224d4a8-336c-429b-bff4-0a598df3dfb1';
UPDATE leads SET client_number_running = 2, client_number = 'BSD-C-2607-1002' WHERE id = '17649db7-b1e8-4236-b063-b52975992832';
UPDATE leads SET client_number_running = 3, client_number = 'BSD-C-2607-1003' WHERE id = '19451180-9160-4146-8ad1-4e892489616e';
UPDATE leads SET client_number_running = 4, client_number = 'BSD-C-2607-1004' WHERE id = '2164b1d6-61cb-4283-991b-db77e2dab41b';
UPDATE leads SET client_number_running = 5, client_number = 'BSD-C-2607-1005' WHERE id = '21feb5af-9f6e-49a1-a8d1-4f1e67c5ca02';
UPDATE leads SET client_number_running = 6, client_number = 'BSD-C-2607-1006' WHERE id = '287bcec3-14fd-4d85-a40a-40d23f05737a';
UPDATE leads SET client_number_running = 7, client_number = 'BSD-C-2607-1007' WHERE id = '2c519080-91f8-41dd-b396-9412b703ed40';
UPDATE leads SET client_number_running = 8, client_number = 'BSD-C-2607-1008' WHERE id = '2de0d1a7-2f48-42c1-a9bc-27c459b30375';
UPDATE leads SET client_number_running = 9, client_number = 'BSD-C-2607-1009' WHERE id = '32506d98-3ff9-4621-9c0b-b490dc3b1cf6';
UPDATE leads SET client_number_running = 10, client_number = 'BSD-C-2607-1010' WHERE id = '3327f999-5610-4141-adf5-25ee1e750c22';
UPDATE leads SET client_number_running = 11, client_number = 'BSD-C-2607-1011' WHERE id = '36f32224-b30f-4d43-8132-d88cc3c0121d';
UPDATE leads SET client_number_running = 12, client_number = 'BSD-C-2607-1012' WHERE id = '38f5144d-8734-4b37-ba9b-663fb7854f8a';
UPDATE leads SET client_number_running = 13, client_number = 'BSD-C-2607-1013' WHERE id = '3db1a82e-d90f-44d6-80ac-961bbf0ead33';
UPDATE leads SET client_number_running = 14, client_number = 'BSD-C-2607-1014' WHERE id = '3fa4c6bc-35c4-4d9f-8ed7-514990b506ed';
UPDATE leads SET client_number_running = 15, client_number = 'BSD-C-2607-1015' WHERE id = '4442ffba-29b2-440f-b4a0-1d71ec6bfc70';
UPDATE leads SET client_number_running = 16, client_number = 'BSD-C-2607-1016' WHERE id = '46a0f8a9-ef67-47b7-8777-b5283245ba62';
UPDATE leads SET client_number_running = 17, client_number = 'BSD-C-2607-1017' WHERE id = '4c9e01a6-1319-4118-9e17-a698d4c228c3';
UPDATE leads SET client_number_running = 18, client_number = 'BSD-C-2607-1018' WHERE id = '597f4581-4ce4-4616-911c-472876dbcdce';
UPDATE leads SET client_number_running = 19, client_number = 'BSD-C-2607-1019' WHERE id = '66ce64b9-22dc-427a-9a79-df93b07b871a';
UPDATE leads SET client_number_running = 20, client_number = 'BSD-C-2607-1020' WHERE id = '6b068961-47ca-47e3-b8e7-f46713f129cb';
UPDATE leads SET client_number_running = 21, client_number = 'BSD-C-2607-1021' WHERE id = '6b313004-5811-49e2-a2ef-a32ef336f929';
UPDATE leads SET client_number_running = 22, client_number = 'BSD-C-2607-1022' WHERE id = '714fc7e4-408c-4c0a-80a4-7ce398505116';
UPDATE leads SET client_number_running = 23, client_number = 'BSD-C-2607-1023' WHERE id = '72c41047-bb1c-4fa9-8094-c36ac1a25dfe';
UPDATE leads SET client_number_running = 24, client_number = 'BSD-C-2607-1024' WHERE id = '7ac30e99-8dc5-439e-99b0-17a2f50c8a74';
UPDATE leads SET client_number_running = 25, client_number = 'BSD-C-2607-1025' WHERE id = '8025412d-435b-4bf8-91f9-8421b7ecb238';
UPDATE leads SET client_number_running = 26, client_number = 'BSD-C-2607-1026' WHERE id = '85e9e74f-7139-42cf-91ad-5b8841946819';
UPDATE leads SET client_number_running = 27, client_number = 'BSD-C-2607-1027' WHERE id = '8b7b10f2-80b1-422d-a704-63adde0108a3';
UPDATE leads SET client_number_running = 28, client_number = 'BSD-C-2607-1028' WHERE id = '8f491ef4-882e-4e6c-a8d0-078cf687e577';
UPDATE leads SET client_number_running = 29, client_number = 'BSD-C-2607-1029' WHERE id = '950ef810-88ad-4aae-9fcd-2d2617b5849d';
UPDATE leads SET client_number_running = 30, client_number = 'BSD-C-2607-1030' WHERE id = 'b70f26da-6c47-4072-8d13-07ede2a44b84';
UPDATE leads SET client_number_running = 31, client_number = 'BSD-C-2607-1031' WHERE id = 'b80996ab-46b6-4a86-adb3-e5f021ea6181';
UPDATE leads SET client_number_running = 32, client_number = 'BSD-C-2607-1032' WHERE id = 'b9817268-a919-4f68-93ac-e6120831cc07';
UPDATE leads SET client_number_running = 33, client_number = 'BSD-C-2607-1033' WHERE id = 'c498e885-870f-4441-aa7c-7fdd18fdb330';
UPDATE leads SET client_number_running = 34, client_number = 'BSD-C-2607-1034' WHERE id = 'c4e6515c-de3c-4999-94ef-45082d05d1d3';
UPDATE leads SET client_number_running = 35, client_number = 'BSD-C-2607-1035' WHERE id = 'cd008982-665a-4d7a-80fd-738814bc3f94';
UPDATE leads SET client_number_running = 36, client_number = 'BSD-C-2607-1036' WHERE id = 'd9025e85-1ed8-4694-bce9-0d56e3a1e170';
UPDATE leads SET client_number_running = 37, client_number = 'BSD-C-2607-1037' WHERE id = 'dc9709b2-e7cd-41d3-b71a-eb483694c3a6';
UPDATE leads SET client_number_running = 38, client_number = 'BSD-C-2607-1038' WHERE id = 'e3363595-b2b8-4f98-8663-172d064d26e0';
UPDATE leads SET client_number_running = 39, client_number = 'BSD-C-2607-1039' WHERE id = 'e5dc567d-11a9-42f7-9d7d-e2cd94a18db8';
UPDATE leads SET client_number_running = 40, client_number = 'BSD-C-2607-1040' WHERE id = 'e9442e86-3445-46fe-aefe-d96d2ce2b666';
UPDATE leads SET client_number_running = 41, client_number = 'BSD-C-2607-1041' WHERE id = 'ead2455c-6aa9-480b-b0bd-a927064a9a32';
UPDATE leads SET client_number_running = 42, client_number = 'BSD-C-2607-1042' WHERE id = 'eb643ec8-6810-41ec-aef0-e8f7bae6bd7c';
UPDATE leads SET client_number_running = 43, client_number = 'BSD-C-2607-1043' WHERE id = 'ecf570db-1429-4333-9f9f-bbe7e10ffab3';
UPDATE leads SET client_number_running = 44, client_number = 'BSD-C-2607-1044' WHERE id = 'f99bf379-e4b5-49fa-8119-1698504e322c';
UPDATE leads SET client_number_running = 45, client_number = 'BSD-C-2607-1045' WHERE id = 'ff43bc17-fbfc-4cba-b976-da9f3497eea6';
UPDATE leads SET client_number_running = 46, client_number = 'BSD-C-2607-1046' WHERE id = '47e85c5c-9459-452b-a26d-4296ed580c98';
UPDATE leads SET client_number_running = 47, client_number = 'BSD-C-2607-1047' WHERE id = 'ca64702b-7e14-48c4-9ef4-1d6503d8ecba';
UPDATE leads SET client_number_running = 48, client_number = 'BSD-C-2607-1048' WHERE id = 'dbdb49ac-cf08-4499-a9da-cc5e1d89ef0c';
UPDATE leads SET client_number_running = 49, client_number = 'BSD-C-2607-1049' WHERE id = 'f91a1dca-a861-4dcb-9194-426fa505601c';
UPDATE leads SET client_number_running = 50, client_number = 'BSD-C-2607-1050' WHERE id = '8861e1c7-a08a-4cbc-a353-8a0521a1b898';
UPDATE leads SET client_number_running = 51, client_number = 'BSD-C-2607-1051' WHERE id = '51656fe1-f92c-4226-ad64-e5b41cc0cecc';
UPDATE leads SET client_number_running = 52, client_number = 'BSD-C-2607-1052' WHERE id = 'ae3f838e-9da8-4a66-83ce-c261596e67cb';
UPDATE leads SET client_number_running = 53, client_number = 'BSD-C-2607-1053' WHERE id = '5dc9fdd2-7f68-4393-a44e-d42e41501e04';
UPDATE leads SET client_number_running = 54, client_number = 'BSD-C-2607-1054' WHERE id = 'd4b5b4c9-25ee-4efa-aa49-dc845deeef5b';
UPDATE leads SET client_number_running = 55, client_number = 'BSD-C-2607-1055' WHERE id = 'f1b9544e-24a9-4d8b-abaf-e815ac86a33c';
UPDATE leads SET client_number_running = 56, client_number = 'BSD-C-2607-1056' WHERE id = '989dc21a-91a6-491e-ab7d-b954fb9868c5';
UPDATE leads SET client_number_running = 57, client_number = 'BSD-C-2608-1057' WHERE id = '29fc2b1d-ad61-4a4c-adb1-1882117403ec';
UPDATE leads SET client_number_running = 58, client_number = 'BSD-C-2608-1058' WHERE id = '63aab4f9-3d49-465c-9f4c-90e25fa7dd98';
UPDATE leads SET client_number_running = 59, client_number = 'BSD-C-2608-1059' WHERE id = '0d44089e-1a38-418a-8731-2273acd39107';
UPDATE leads SET client_number_running = 60, client_number = 'BSD-C-2608-1060' WHERE id = '6b5a02c6-0859-40a6-b888-f287a6f1234e';
UPDATE leads SET client_number_running = 61, client_number = 'BSD-C-2608-1061' WHERE id = '895c02f5-b850-4eb8-a54e-1439ca8653f1';
UPDATE leads SET client_number_running = 62, client_number = 'BSD-C-2608-1062' WHERE id = 'fd649acf-ce93-4b5d-8fb7-821f28abf41f';
UPDATE leads SET client_number_running = 63, client_number = 'BSD-C-2608-1063' WHERE id = '4f73cc2f-d2d8-46e5-b73b-c234695688ea';
UPDATE leads SET client_number_running = 64, client_number = 'BSD-C-2608-1064' WHERE id = 'e5830bf3-8a2e-46e1-8463-d8bda3fd7fe0';
UPDATE leads SET client_number_running = 65, client_number = 'BSD-C-2608-1065' WHERE id = 'd0e127f9-d9d1-4c82-8ff6-7827bf4a6878';
UPDATE leads SET client_number_running = 66, client_number = 'BSD-C-2608-1066' WHERE id = '687be2ad-a66e-4424-ac7a-f1f1c43d3a0a';
UPDATE leads SET client_number_running = 67, client_number = 'BSD-C-2608-1067' WHERE id = 'c67fd64a-24be-4adb-b6c2-6482720fa034';
UPDATE leads SET client_number_running = 68, client_number = 'BSD-C-2608-1068' WHERE id = 'afba9e2a-2533-4127-9f86-aefcd4f016fb';
UPDATE leads SET client_number_running = 69, client_number = 'BSD-C-2608-1069' WHERE id = '32b7886a-4320-46c4-987d-a325ec37b89b';
UPDATE leads SET client_number_running = 70, client_number = 'BSD-C-2608-1070' WHERE id = 'fe75bea8-fdf6-4e4c-9be0-452ccaf26385';
UPDATE leads SET client_number_running = 71, client_number = 'BSD-C-2608-1071' WHERE id = '8ed51cc1-112e-4519-8e86-7bfe2e2d54c2';
UPDATE leads SET client_number_running = 72, client_number = 'BSD-C-2608-1072' WHERE id = '53cc456a-4fc9-41d7-ac01-150b10a36936';
UPDATE leads SET client_number_running = 73, client_number = 'BSD-C-2608-1073' WHERE id = 'aaaa0a65-5522-4274-91ef-8094ed5e20ab';
UPDATE leads SET client_number_running = 74, client_number = 'BSD-C-2608-1074' WHERE id = '59a2d1e7-daa1-474d-ac45-9d2ac76ad622';
UPDATE leads SET client_number_running = 75, client_number = 'BSD-C-2608-1075' WHERE id = '5d31edb2-f442-4887-8c01-199b911209de';
UPDATE leads SET client_number_running = 76, client_number = 'BSD-C-2608-1076' WHERE id = '8b77e0aa-8869-4744-a89a-eaa5ca6465d0';
UPDATE leads SET client_number_running = 77, client_number = 'BSD-C-2608-1077' WHERE id = '037d94b7-aa4b-4320-a939-03847c210abb';
UPDATE leads SET client_number_running = 78, client_number = 'BSD-C-2608-1078' WHERE id = '2c8443e7-ba31-4804-9f5a-96b2b9d60c00';
UPDATE leads SET client_number_running = 79, client_number = 'BSD-C-2608-1079' WHERE id = 'ba09048b-425a-4844-a28b-4382169cd7e4';
UPDATE leads SET client_number_running = 80, client_number = 'BSD-C-2608-1080' WHERE id = '060deec8-b2cb-4cdd-8bda-c0fc6b103160';
UPDATE leads SET client_number_running = 81, client_number = 'BSD-C-2608-1081' WHERE id = 'e3217e05-bce1-496a-94e1-18c78f70286d';
UPDATE leads SET client_number_running = 82, client_number = 'BSD-C-2608-1082' WHERE id = '4f7c6739-8b05-4021-b7de-fd5035b48a99';
UPDATE leads SET client_number_running = 83, client_number = 'BSD-C-2608-1083' WHERE id = '12c420c8-deef-41a3-a754-9933cf7f15f4';
UPDATE leads SET client_number_running = 84, client_number = 'BSD-C-2608-1084' WHERE id = 'f6b99763-39b5-4491-a28d-3281f5ad6bb0';
UPDATE leads SET client_number_running = 85, client_number = 'BSD-C-2608-1085' WHERE id = '082a779b-8bd7-4610-b1e4-2ce2bf516ab7';
UPDATE leads SET client_number_running = 86, client_number = 'BSD-C-2608-1086' WHERE id = '63cc1275-17c4-4043-bb31-3ec90493d4b9';
UPDATE leads SET client_number_running = 87, client_number = 'BSD-C-2608-1087' WHERE id = 'eb1537bc-44d9-4fc8-9ee7-f791637bb85b';
UPDATE leads SET client_number_running = 88, client_number = 'BSD-C-2608-1088' WHERE id = 'c9dcd4e4-6eac-4e95-b8a0-2921dbe3001a';
SELECT setval('client_number_seq', 88+1000, true);
ALTER TABLE leads ADD CONSTRAINT client_number_unique UNIQUE (client_number);
ALTER TABLE leads ADD CONSTRAINT client_number_running_unique UNIQUE (client_number_running);

CREATE TABLE IF NOT EXISTS business_number_correction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id),
  old_number text, new_number text, reason text,
  approved_by text, changed_by text, changed_at timestamptz DEFAULT now()
);


CREATE TABLE IF NOT EXISTS client_number_correction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id),
  old_number text, new_number text, reason text,
  approved_by text, changed_by text, changed_at timestamptz DEFAULT now()
);


CREATE OR REPLACE VIEW businesses_anonymous_card AS
SELECT id, COALESCE(anon_display_name, field) AS anon_display_name,
    field, category, subcategory, city, years_active, annual_revenue, operating_profit,
    net_profit, employees_count, anon_summary,
    CASE WHEN anon_card_show_price THEN asking_price ELSE NULL::numeric END AS asking_price,
    handled_by, anon_card_active, distribution_status, anon_summary_generated_at, created_at, updated_at,
    business_number
FROM businesses b
WHERE anon_summary IS NOT NULL AND get_business_access_level(id, auth.uid()) = 'anonymous'::text;


CREATE OR REPLACE VIEW businesses_social_feed AS
SELECT id, anon_display_name, anon_summary, field, category, subcategory, city,
    CASE WHEN anon_card_show_price THEN asking_price ELSE NULL::numeric END AS asking_price,
    business_number
FROM businesses
WHERE anon_card_active = true AND anon_summary IS NOT NULL AND anon_display_name IS NOT NULL;


CREATE OR REPLACE VIEW public_business_listings AS
SELECT id, field, category, subcategory, region, years_active, annual_revenue,
    employees_count, anon_display_name, anon_summary AS short_description,
    CASE WHEN anon_card_show_price THEN asking_price ELSE NULL::numeric END AS asking_price,
    created_at,
    business_number
FROM businesses b
WHERE public_listing_active = true AND anon_card_active = true AND listing_status = 'active'::text;

COMMIT;