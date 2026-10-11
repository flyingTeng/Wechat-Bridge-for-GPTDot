CREATE TABLE `binding` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`consent_version` text NOT NULL,
	`consent_at` integer NOT NULL,
	`bot_token` text,
	`bot_id` text,
	`recipient_id` text,
	`base_url` text,
	`context_token` text,
	`context_at` integer,
	`cursor` text,
	`qr_id` text,
	`qr_payload` text,
	`flow_id` text,
	`qr_expires` integer
);
--> statement-breakpoint
CREATE TABLE `test_runs` (
	`kind` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`client_id` text NOT NULL,
	`state` text NOT NULL,
	`attempted_at` integer NOT NULL,
	`confirmed_at` integer,
	`error_code` text
);
