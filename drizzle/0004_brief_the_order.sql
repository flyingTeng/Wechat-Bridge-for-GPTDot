CREATE TABLE `brief_notices` (
	`dedup_hash` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`owner_id` text NOT NULL,
	`binding_generation` text NOT NULL,
	`client_id` text NOT NULL,
	`state` text NOT NULL,
	`attempted_at` integer NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`binding_generation` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
