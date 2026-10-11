CREATE TABLE `inbound_dedup` (
	`message_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`binding_generation` text NOT NULL,
	`acknowledged_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbound_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`binding_generation` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`enabled_at` integer NOT NULL,
	`cursor` text NOT NULL,
	`last_poll_at` integer,
	`lease_id` text,
	`lease_expires` integer,
	`pending_batch` text,
	`pending_cursor` text,
	`pending_keys` text,
	`last_ack_batch` text,
	`error_code` text
);
